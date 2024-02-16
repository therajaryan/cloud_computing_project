const express = require('express');
const fs = require('fs');
const csv = require('csv');

const app = express();
const port = 8080;

// Parse the CSV file and populate predictions
csv.parseFile('dataset.csv', (err, data) => {
    if (err) {
        console.error('Error reading prediction file:', err);
        process.exit(1);
    }
    
    const predictions = {};
    data.forEach(row => {
        predictions[row[0]] = row[1];
    });

    // Start the server after predictions are populated
    startServer(predictions);
});

// Function to start the server
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
