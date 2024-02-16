const express = require('express');
const fs = require('fs');
const csv = require('csv');

const app = express();
const port = 8080;
//  process.env.PORT || 8080; 

const predictions = {};
csv.parseFile('classification_face_images_1000.csv', (err, data) => {
    if (err) {
        console.error('Error reading prediction file:', err);
        process.exit(1);
    }
    data.forEach(row => {
        predictions[row[0]] = row[1];
    });
});

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
