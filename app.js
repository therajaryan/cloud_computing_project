const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const multer = require('multer');

const app = express();
const port = 8080;

const predictions = {};
fs.createReadStream('dataset.csv')
    .pipe(csv())
    .on('data', (row) => {
        predictions[row[0]] = row[1];
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

    app.post('/', upload.single('inputFile'), (req, res) => {
        if (!req.file) {
            return res.status(400).send('No image file uploaded!');
        }

        const filename = req.file.filename;

        console.log("File -> ", req.file);
        console.log("CSV ->", predictions);

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
