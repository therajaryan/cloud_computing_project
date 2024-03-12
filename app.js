const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const multer = require('multer');
const AWS = require('aws-sdk');

const app = express();
const port = 8080;

const config = require('./config.json');

const aws_access_key_id = config.aws_access_key_id;
const aws_secret_access_key = config.aws_secret_access_key;
const region = config.region;

// Configure AWS credentials
AWS.config.update({
  accessKeyId: aws_access_key_id,
  secretAccessKey: aws_secret_access_key,
  region: region
});

// Create an S3 instance
const s3 = new AWS.S3();

// Create an SQS instance
const sqs = new AWS.SQS();

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Load predictions from dataset.csv
const predictions = {};
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

// Start the Express server
function startServer(predictions) {
  app.post('/', upload.single('inputFile'), async (req, res) => {
    try {
      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).send('No image file uploaded!');
      }

      // Upload image file to S3 bucket
      const uploadParams = {
        Bucket: 'YOUR_S3_BUCKET_NAME',
        Key: req.file.originalname,
        Body: fs.createReadStream(req.file.path)
      };
      await s3.upload(uploadParams).promise();

      // Delete the temporary file after upload
      fs.unlinkSync(req.file.path);

      // Send message to request queue
      const sqsParams = {
        MessageBody: req.file.originalname,
        QueueUrl: 'YOUR_SQS_REQUEST_QUEUE_URL'
      };
      await sqs.sendMessage(sqsParams).promise();

      res.status(200).send('Image uploaded successfully!');
    } catch (error) {
      console.error('Error:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}
