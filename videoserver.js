const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const { SpeechClient } = require('@google-cloud/speech').v1p1beta1;
const fs = require('fs');

const app = express();
app.use(cors());
const port = process.env.PORT || 8000;

// Set up Google Cloud Storage using service account key from environment variable
const storage = new Storage({
  projectId: "summary-master-sdp",
  credentials: JSON.parse(process.env.CLOUD_STORAGE_KEYFILE)
});
const bucketName = 'summary-master'; // Replace with your GCS bucket name
const bucket = storage.bucket(bucketName);

// Set up Google Cloud Speech-to-Text
const speechClient = new SpeechClient({
  projectId: "summary-master-sdp", // Replace with your Google Cloud project ID
  credentials: JSON.parse(process.env.SPEECH_TO_TEXT_KEYFILE)
});

// Configure multer for handling file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Define endpoint for uploading MP4 files
app.post('/upload-video', upload.single('videoFile'), async (req, res) => {
  try {
    const file = req.file;
    console.log('Received file:', file); // Log received file for debugging
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Configure audio settings for speech recognition
    const audioConfig = {
      encoding: 'LINEAR16', // Use LINEAR16 for audio from video files
      sampleRateHertz: 44100, // Adjust as needed based on the audio in your video
      languageCode: 'en-US', // Language code
      enableAutomaticPunctuation: true // Enable automatic punctuation
    };

    // Configure the audio source from video file
    const audio = {
      content: file.buffer.toString('base64')
    };

    console.log('Sending audio:', audio); // Log audio content for debugging

    // Set up the speech recognition request
    const request = {
      audio: audio,
      config: audioConfig
    };

    console.log('Sending request:', request); // Log speech recognition request for debugging

    // Perform the speech recognition
    const [response] = await speechClient.recognize(request);

    console.log('Received response:', response); // Log received response for debugging

    // Process the transcription response
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    console.log('Transcription:', transcription); // Log transcription for debugging

    // Save the transcription to a file
    fs.writeFile('transcript.txt', transcription, 'utf8', (err) => {
      if (err) {
        console.error('Error saving transcription:', err);
        res.status(500).json({ error: 'Failed to save transcription' });
      } else {
        console.log('Transcription saved successfully');
        // Respond with the transcription
        res.status(200).sendFile('transcript.txt', { root: __dirname });
      }
    });
  } catch (error) {
    console.error('Error processing video:', error);
    res.status(500).json({ error: 'Failed to process video' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
