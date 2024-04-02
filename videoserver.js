const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const { SpeechClient } = require('@google-cloud/speech').v1;
const ffmpeg = require('fluent-ffmpeg');
const MemoryStream = require('memorystream');

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
const upload = multer();

// Define endpoint for uploading MP4 files
app.post('/upload-video', upload.single('videoFile'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Create a readable stream from the uploaded MP4 file buffer
    const readableStream = new MemoryStream(req.file.buffer);

    // Configure ffmpeg to read from the stream and extract audio
    const audioStream = readableStream.pipe(ffmpeg().format('wav').audioCodec('pcm_s16le').outputOptions('-vn'));

    // Collect the extracted audio into a buffer
    const audioChunks = [];
    audioStream.on('data', chunk => audioChunks.push(chunk));
    audioStream.on('end', async () => {
      // Concatenate the audio chunks into a single buffer
      const audioBuffer = Buffer.concat(audioChunks);

      // Convert the audio buffer to base64 encoding
      const audioContent = audioBuffer.toString('base64');

      // Configure audio settings for speech recognition
      const audioConfig = {
        encoding: 'LINEAR16', // Adjust as needed
        sampleRateHertz: 44100, // Adjust as needed
        languageCode: 'en-US', // Language code
        enableAutomaticPunctuation: true // Enable automatic punctuation
      };

      // Set up the speech recognition request
      const request = {
        audio: { content: audioContent },
        config: audioConfig
      };

      // Perform the speech recognition
      const [response] = await speechClient.recognize(request);

      // Process the transcription response
      const transcription = response.results
        .map(result => result.alternatives[0].transcript)
        .join('\n');

      // Respond with the transcription
      res.status(200).json({ textContent: transcription });
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
