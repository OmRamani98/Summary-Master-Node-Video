const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { SpeechClient } = require('@google-cloud/speech').v1;
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const port = process.env.PORT || 8001;

// Enable CORS for requests from the React app
const cors = require('cors');
app.use(cors());

// Configure multer for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Generate a dynamic filename with a unique suffix
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Function to split audio into 1-second segments
const splitAudioIntoSegments = async (filePath) => {
  const audioSegments = [];

  // Read the audio file
  const audioData = fs.readFileSync(filePath);
  const audioLength = audioData.length;
  const segmentSize = 16000 * 2; // Assuming 16-bit audio at 16 kHz (1-second segment)

  // Split the audio into segments
  for (let i = 0; i < audioLength; i += segmentSize) {
    const segment = audioData.slice(i, i + segmentSize);
    audioSegments.push(segment);
  }

  return audioSegments;
};

// POST endpoint for handling video file upload and text extraction
app.post('/upload', upload.single('videoFile'), async (req, res) => {
  const videoPath = req.file.path;
  const outputPath = path.join(__dirname, 'uploads', 'output.mp3');

  console.log('Video uploaded:', videoPath);

  try {
    // Convert video to audio with MP3 encoding
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .toFormat('mp3')
        .output(outputPath)
        .on('end', () => {
          console.log('Audio conversion completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('Audio conversion error:', err);
          reject(err);
        })
        .run();
    });

    console.log('Audio file created:', outputPath);

    // Create a Speech-to-Text client
    const client = new SpeechClient({
      keyFilename: 'speech-to-text.json' // Replace with your Google Cloud service account key file path
    });

    // Read the audio file
    const audioData = fs.readFileSync(outputPath);

    // Define recognition config
    const config = {
      sampleRateHertz: 16000,
      languageCode: 'en-US',
      encoding: 'MP3',
      enableAutomaticPunctuation: true
    };

    const audio = {
      content: audioData.toString('base64')
    };

    console.log('Starting speech recognition');

    // Perform speech recognition
    const [response] = await client.recognize({
      audio: audio,
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
    // Delete the temporary uploaded files
    fs.unlinkSync(videoPath);
    fs.unlinkSync(outputPath);
    console.log('Temporary files deleted');
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
