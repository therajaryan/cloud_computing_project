const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const multer = require('multer');
const AWS = require('aws-sdk');

const app = express();
const port = 8000;

const config = require('./config.json');

const aws_access_key_id = config.aws_access_key_id;
const aws_secret_access_key = config.aws_secret_access_key;
const region = config.region;
const sqs_request_url = config.sqs_request_url;
const sqs_response_url = config.sqs_response_url;
const s3_input_bucket = config.s3_input_bucket;
const s3_output_bucket = config.s3_output_bucket;
const input_path = config.input_path;
const START_SCRIPT = `#!/bin/bash
cd /home/ubuntu/cloud_computing_project/
sudo -u ubuntu node app_tier.js`;

// Configure AWS credentials and region
AWS.config.update({
    accessKeyId: aws_access_key_id,
    secretAccessKey: aws_secret_access_key,
    region: region
});

const SQS_REQUEST_URL = sqs_request_url;
const SQS_RESPONSE_URL = sqs_response_url;
const S3_INPUT_BUCKET = s3_input_bucket;
const S3_OUTPUT_BUCKET = s3_output_bucket;
const INPUT_PATH = input_path;
const APP_TIER_AMI_ID = 'ami-022e2c2507eb19364';

// Thresholds for scaling actions
const SCALE_OUT_THRESHOLD = 5;
const SCALE_IN_THRESHOLD = 0;
const SCALE_CHECK_INTERVAL = 10000;
const MAX_INSTANCES = 19;
const MIN_INSTANCES = 0;

// Tracking for scale-in and scale-out
let lastActivityTime = Date.now();
let lastScaleInReqTime = Date.now();
let scaleOutCooldown = false;

// Create an S3 instance
const s3 = new AWS.S3();

// Create an SQS instance
const sqs = new AWS.SQS();

const ec2 = new AWS.EC2();

// const predictions = {};

// Load dataset.csv into predictions map
// fs.createReadStream('dataset.csv')
//     .pipe(csv())
//     .on('data', (row) => {
//         predictions[row['Image']] = row['Results'];
//     })
//     .on('end', () => {
//         startServer(predictions);
//     })
//     .on('error', (err) => {
//         console.error('Error reading prediction file:', err);
//         process.exit(1);
//     });
let instanceCount = 0;
const ec2InstanceSet = new Set();

function startServer(predictions) {
    const upload = multer({ dest: 'uploads/' });
    async function handleMessage(receiveParams, res, filenameWithoutExtension) {
        try {
            const receiveResult = await sqs.receiveMessage(receiveParams).promise();
            if (!receiveResult.Messages || receiveResult.Messages.length === 0) {
                console.log('No messages found in SQS queue');
                return res.status(404).send('No classification result found');
            }
    
            const message = receiveResult.Messages[0];
            const messageBody = message.Body;
    
            // Log the received message body
            console.log('Received message:', messageBody);
    
            // Split the message body into parts
            const parts = messageBody.split(',');
    
            // Check if the message body has the expected format
            if (parts.length !== 2) {
                console.error('Unexpected message format:', messageBody);
                // Continue polling recursively until the correct message is found
                return handleMessage(receiveParams, res, filenameWithoutExtension);
            }
    
            const [returnedFileName, recognitionResult] = parts;
    
            if (returnedFileName === filenameWithoutExtension) {
                await s3.putObject({
                    Bucket: S3_OUTPUT_BUCKET,
                    Key: filenameWithoutExtension,
                    Body: recognitionResult
                }).promise();
    
                await sqs.deleteMessage({
                    QueueUrl: SQS_RESPONSE_URL,
                    ReceiptHandle: message.ReceiptHandle
                }).promise();
    
                // Send the classification result to the client
                res.send(`${filenameWithoutExtension}:${recognitionResult}`);
            } else {
                // Continue polling recursively until the correct message is found
                return handleMessage(receiveParams, res, filenameWithoutExtension);
            }
        } catch (error) {
            console.error('Error receiving message from SQS:', error);
            res.status(500).send('Internal Server Error');
        }
    }    
    
    // Handle POST request for image upload
    app.post('/', upload.single('inputFile'), (req, res) => {
        if (!req.file) {
            return res.status(400).send('No image file uploaded!');
        }

        const filename = req.file.originalname;
        const filenameWithoutExtension = filename.split('.')[0]; // Remove the file extension

        // Upload image to S3 input bucket
        const uploadParams = {
            Bucket: S3_INPUT_BUCKET,
            Key: filenameWithoutExtension,
            Body: fs.createReadStream(req.file.path)
        };

        s3.upload(uploadParams, async (err, data) => {
            if (err) {
                console.error('Error uploading image to S3:', err);
                return res.status(500).send('Internal Server Error');
            }

            // Send message to SQS request queue
            const sqsParams = {
                MessageBody: filenameWithoutExtension,
                QueueUrl: SQS_REQUEST_URL
            };

            sqs.sendMessage(sqsParams, async (err, data) => {
                if (err) {
                    console.error('Error sending message to SQS:', err);
                    return res.status(500).send('Internal Server Error');
                }

                // Poll SQS response queue for result
                const receiveParams = {
                    QueueUrl: SQS_RESPONSE_URL,
                    MaxNumberOfMessages: 1,
                    WaitTimeSeconds: 20
                };

                if (instanceCount == 0) {
                    console.log('post API, no ec2Instance found');
                    await autoScale();
                }
                lastActivityTime = Date.now(); // Update last activity time
		    try {
		            // Start polling for messages
		            await handleMessage(receiveParams, res, filenameWithoutExtension);
		        } catch (error) {
		            console.error('Error handling message:', error);
		            res.status(500).send('Internal Server Error');
		        }
            });
        });
    });

    startServer();
    app.listen(port, async () => {
        console.log(`Server listening on port ${port}`);

        // Start autoscaling task
        setInterval(autoScale, 10000);
    });
}

const { v4: uuidv4 } = require('uuid'); // Importing UUID library

async function launchNewInstance() {
    const params = {
        ImageId: APP_TIER_AMI_ID,
        InstanceType: "t2.micro",
        MinCount: 1,
        MaxCount: 1,
        KeyName: 'my_key_pair', 
        SecurityGroupIds: ['sg-0c159ba62ee2666e9'],
		UserData: Buffer.from(START_SCRIPT).toString('base64')
    };

    try {
		if (instanceCount >= MAX_INSTANCES)
		{
			console.log('max instances reached, increase total limit')
			return
		}
		instanceCount++;
        const instanceName = `app-tier-instance-${uuidv4()}`;

        // Add instance name to the params
        params.TagSpecifications = [
            {
                ResourceType: "instance",
                Tags: [
                    {
                        Key: "Name",
                        Value: instanceName
                    },
                    // Add other tags if needed
                ]
            }
        ];

        // Launch the instance with the provided params
        const data = await ec2.runInstances(params).promise();
        console.log("Successfully launched instance", data.Instances[0].InstanceId);
		ec2InstanceSet.add(data.Instances[0].InstanceId);

        // Additional setup or tagging can be done here
    } catch (error) {
        console.error("Failed to launch instance:", error);
		instanceCount--;
    }
}


async function getQueueLength(queueUrl) {
    const params = {
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages']
    };

    const data = await sqs.getQueueAttributes(params).promise();
    return parseInt(data.Attributes.ApproximateNumberOfMessages, 10);
}

async function terminateInstance(instanceId) {
    const params = {
        InstanceIds: [instanceId],
    };
    try {
		instanceCount--;
        await ec2.terminateInstances(params).promise();
        console.log(`Successfully requested termination of instance ${instanceId}`);
		ec2InstanceSet.delete(instanceId);
    } catch (error) {
		instanceCount++;
        console.error("Failed to terminate instance:", error);
    }
}

async function autoScale() {
    const queueLength = await getQueueLength(SQS_REQUEST_URL);
    console.log('Queue length:', queueLength);
	console.log("checking scaling");
	console.log("instanceCount = ", instanceCount);
	if (instanceCount == 0 && queueLength > 0)
	{
		console.log("No instance detected, launching right away");
		await launchNewInstance();
	}
	
    // Scale Out: If pending requests exceed the threshold, launch a new instance.
    else if (queueLength / instanceCount >= SCALE_OUT_THRESHOLD && instanceCount < MAX_INSTANCES) {
        console.log("Scaling out due to high load...");
        await launchNewInstance();
    }
    // Scale In: If the load decreases significantly, terminate an instance.
    else if (queueLength <= SCALE_IN_THRESHOLD && instanceCount > MIN_INSTANCES) {
        console.log("Scaling in due to low load...");
		const iterator = ec2InstanceSet.values();
		const first = iterator.next().value;
        await terminateInstance(first);
    }
}
