const express = require('express');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const { SpeechClient } = require('@google-cloud/speech').v1;
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 8001;

// Initialize Google Cloud Storage client
const storageClient = new Storage({
  projectId: "summary-master-sdp",
  credentials: JSON.parse(process.env.CLOUD_STORAGE_KEYFILE)
});
const bucketName = 'summary-master'; // Replace with your bucket name

// Initialize Google Cloud Speech-to-Text client
const speechClient = new SpeechClient({
  projectId: "summary-master-sdp", // Replace with your Google Cloud project ID
  credentials: JSON.parse(process.env.SPEECH_TO_TEXT_KEYFILE)
});

// Set up CORS middleware
app.use(cors());

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Define route for uploading MP4 file and extracting transcript
app.post('/upload-video', upload.single('videoFile'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).send('No file uploaded.');
    }

    // Upload the MP4 file to Google Cloud Storage
    const fileName = `${Date.now()}-${file.originalname}`;
    const fileUpload = storageClient.bucket(bucketName).file(fileName);
    await fileUpload.save(file.buffer);

    console.log('File uploaded to Google Cloud Storage:', fileName);

    // Transcribe the audio from the MP4 file using LongRunningRecognize method
// const audioConfig = {
//     sampleRateHertz: 16000,
//     languageCode: 'en-US',
//     encoding: 'MP3', // This line specifies the encoding as MP3
//     enableAutomaticPunctuation: true
// };
const audioConfig = {
    sampleRateHertz: 16000,
    languageCode: 'en-US',
    encoding: 'LINEAR16', // Change encoding to LINEAR16
    enableAutomaticPunctuation: true
};

    const audio = {
      uri: `gs://${bucketName}/${fileName}`,
    };

    const [operation] = await speechClient.longRunningRecognize({ audio, config: audioConfig });
    const [response] = await operation.promise();

    const transcriptions = response.results.map(result => result.alternatives[0].transcript).join('\n');
    
    res.json({ textContent: transcriptions });
    
    // Delete the temporary uploaded file from Google Cloud Storage
    await fileUpload.delete();
    console.log('Temporary file deleted from Google Cloud Storage:', fileName);
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ error: 'Failed to process file.' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
