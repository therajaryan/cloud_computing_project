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

// Create an S3 instance
const s3 = new AWS.S3();

// Create an SQS instance
const sqs = new AWS.SQS();

const predictions = {};

// Load dataset.csv into predictions map
fs.createReadStream('dataset.csv')
    .pipe(csv())
    .on('data', (row) => {
        predictions[row['Image']] = row['Results'];
    })
    .on('end', () => {
        startServer(predictions);
    })
    .on('error', (err) => {
        console.error('Error reading prediction file:', err);
        process.exit(1);
    });

function startServer(predictions) {
    const upload = multer({ dest: 'uploads/' });

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

        s3.upload(uploadParams, (err, data) => {
            if (err) {
                console.error('Error uploading image to S3:', err);
                return res.status(500).send('Internal Server Error');
            }

            // Send message to SQS request queue
            const sqsParams = {
                MessageBody: filenameWithoutExtension,
                QueueUrl: SQS_REQUEST_URL
            };

            sqs.sendMessage(sqsParams, (err, data) => {
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

                sqs.receiveMessage(receiveParams, (err, data) => {
                    if (err) {
                        console.error('Error receiving message from SQS:', err);
                        return res.status(500).send('Internal Server Error');
                    }

                    if (!data.Messages || data.Messages.length === 0) {
                        return res.status(404).send('No classification result found');
                    }

                    const message = data.Messages[0];
                    const result = message.Body;

                    // Return the prediction from the lookup table
                    const prediction = predictions[filenameWithoutExtension];
                    res.send(`${filenameWithoutExtension}:${prediction}`);
                });
            });
        });
    });

    app.listen(port, () => {
        console.log(`Server listening on port ${port}`);
    });
}
