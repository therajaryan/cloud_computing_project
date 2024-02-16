const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');

const app = express();
const port = 8080;

// Parse the CSV file and populate predictions
const predictions = {};
fs.createReadStream('dataset.csv')
    .pipe(csv())
    .on('data', (row) => {
        predictions[row[0]] = row[1];
    })
    .on('end', () => {
        // Start the server after predictions are populated
        startServer(predictions);
    })
    .on('error', (err) => {
        console.error('Error reading prediction file:', err);
        process.exit(1);
    });

function startServer(predictions) {
    app.post('/', (req, res) => {
        if (!req.files) {
            return res.status(400).send('No image file uploaded!');
        }

        const file = req.files.inputFile;
        const filename = file.name;

        // Check if filename exists in predictions
        if (!predictions[filename]) {
            return res.status(404).send('Image not found in dataset!');
        }

        // Return the prediction from the lookup table
        const prediction = predictions[filename];
        res.send(`${filename}:${prediction}`);
    });

    app.listen(port, () => {
        console.log(`Server listening on port ${port}`);
    });
}
