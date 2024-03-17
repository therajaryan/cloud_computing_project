const AWS = require('aws-sdk');
const fs = require('fs');
const { execSync } = require('child_process');

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

const sqs = new AWS.SQS();
const s3 = new AWS.S3();

const SQS_REQUEST_URL = sqs_request_url;
const SQS_RESPONSE_URL = sqs_response_url;
const S3_INPUT_BUCKET = s3_input_bucket;
const S3_OUTPUT_BUCKET = s3_output_bucket;
const INPUT_PATH = input_path;

// Function to read requests from SQS and process them
const readRequests = async () => {
  try {
    console.log("1");
    const sqsResponse = await sqs.receiveMessage({
      QueueUrl: SQS_REQUEST_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 30
    }).promise();

    if (!sqsResponse.Messages) return;

    const sqsMessage = sqsResponse.Messages[0];
    console.log("sqsResponse -> ", sqsResponse);
    console.log("SQS Msg -> ", sqsMessage);
    const receiptHandle = sqsMessage.ReceiptHandle;
    console.log(`Message Received: ${sqsMessage.Body}`);
    const imageBody = sqsMessage.Body;

    await downloadImageFromS3(imageBody.split("/").pop());
    
    // Delete received message from SQS
    await sqs.deleteMessage({
      QueueUrl: SQS_REQUEST_URL,
      ReceiptHandle: receiptHandle
    }).promise();

  } catch (error) {
    console.error(`An error occurred while processing requests: ${error}`);
  }
};

// Function to download image from S3
const downloadImageFromS3 = async (imageName) => {
  try {
    console.log("2");
    if (!fs.existsSync(INPUT_PATH)) {
      fs.mkdirSync(INPUT_PATH);
    }

    console.log(`Downloading image: ${imageName}`);
    const s3Params = {
      Bucket: S3_INPUT_BUCKET,
      Key: imageName
    };
    const data = await s3.getObject(s3Params).promise();
    console.log("S3.getobject Data ->", data);
    fs.writeFileSync(INPUT_PATH + imageName, data.Body);

    const response = await classifyImage(INPUT_PATH + imageName, imageName);
    console.log("Classify Image response ->", response);

  } catch (error) {
    console.error(`An error occurred while downloading image: ${error}`);
  }
};

// Function to classify image
const classifyImage = async (pathToFile, imageName) => {
  try {
    console.log("3");
    const classifierPath = '/home/ubuntu/cloud_computing_project/model/face_recognition.py';
    const imageNameWithoutExtension = imageName.split('.')[0]; // Remove the file extension
    const modelPrediction = execSync(`python3 ${classifierPath} ${pathToFile}`).toString();
    const result = modelPrediction.trim();
    console.log(`Classification results: ${result}`);
    const respo = await saveResultInS3Output(imageName, result);
    console.log("saveResultInS3Output response -> ", respo);
    await sendResultToSqsResponse(imageName, result);

  } catch (error) {
    console.error(`An error occurred while classifying image: ${error}`);
  }
};

// Function to save result in S3 output
const saveResultInS3Output = async (key, value) => {
  try {
    console.log("4");
    const result = `(${key},${value})`;
    console.log("result ->", result);
    await s3.putObject({
      Bucket: S3_OUTPUT_BUCKET,
      Key: key.split('.')[0],
      Body: result
    }).promise();

  } catch (error) {
    console.error(`An error occurred while saving the classification result: ${error}`);
  }
};

// Function to send result to SQS response
const sendResultToSqsResponse = async (key, value) => {
  try {
    console.log("5");
    const sqsMessage = `${key},${value}`;
    const sqsResponse = await sqs.sendMessage({
      QueueUrl: SQS_RESPONSE_URL,
      MessageBody: sqsMessage
    }).promise();
    console.log(`Message sent to response queue. MessageId: ${sqsResponse.MessageId}`);

  } catch (error) {
    console.error(`An error occurred while sending the response: ${error}`);
  }
};

// Continuous loop to read requests every 5 seconds
setInterval(readRequests, 5000);
