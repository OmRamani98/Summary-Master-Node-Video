const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const { SpeechClient } = require('@google-cloud/speech').v1;
const path = require('path');
const fs = require('fs'); // Import the fs module
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());
const port = process.env.PORT || 8001;

// Set up Google Cloud Storage using service account key
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

// Function to upload file to GCS
const uploadFileToGCS = async (fileBuffer, fileName) => {
  const file = bucket.file(fileName);
  await file.save(fileBuffer);
  console.log(`File ${fileName} uploaded to GCS.`);
  return `gs://${bucketName}/${fileName}`;
};

// Function to convert video to audio with MP3 encoding
const convertVideoToAudio = (videoBuffer, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoBuffer)
      .toFormat('mp3')
      .on('end', () => {
        console.log('Audio conversion completed');
        resolve();
      })
      .on('error', (err) => {
        console.error('Audio conversion error:', err);
        reject(err);
      })
      .save(outputPath);
  });
};

// POST endpoint for handling video file upload and text extraction
app.post('/upload-video', upload.single('videoFile'), async (req, res) => {
  try {
    const videoBuffer = req.file.buffer;
    const outputPath = 'output.mp3'; // Output audio file path

    console.log('Video uploaded');

    // Convert video to audio with MP3 encoding
    await convertVideoToAudio(videoBuffer, outputPath);

    console.log('Audio file created');

    // Upload audio file to GCS
    const gcsAudioPath = await uploadFileToGCS(fs.readFileSync(outputPath), outputPath);

    // Create a Speech-to-Text client
    const client = new SpeechClient();

    // Define recognition config
    const config = {
      sampleRateHertz: 16000,
      languageCode: 'en-US',
      encoding: 'MP3',
      enableAutomaticPunctuation: true
    };

    // Perform speech recognition
    const [response] = await client.recognize({
      audio: { uri: gcsAudioPath },
      config: config
    });

    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    console.log('Transcription:', transcription);

    res.json({ textContent: transcription });
  } catch (error) {
    console.error('Error extracting text:', error);
    res.status(500).json({ error: 'Failed to extract text' });
  } finally {
    // Clean up temporary files
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
      console.log('Temporary audio file deleted');
    }
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
