const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { SpeechClient } = require('@google-cloud/speech').v1;
const ffmpeg = require('fluent-ffmpeg');

const { Storage } = require('@google-cloud/storage');
const storage = new Storage({
  projectId: "summary-master-sdp",
  credentials: JSON.parse(process.env.CLOUD_STORAGE_KEYFILE)
});
const bucketName = 'summary-master'; // Replace with your bucket name

const app = express();
const port = process.env.PORT || 8001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const multerStorage = multer.memoryStorage();
const upload = multer({
  storage: multerStorage
});

const uploadFileToGCS = async (file) => {
  const bucket = storage.bucket(bucketName);
  const fileName = `${Date.now()}-${file.originalname}`;

  const fileUpload = bucket.file(fileName);

  const fileStream = fileUpload.createWriteStream({
    metadata: {
      contentType: file.mimetype
    },
    resumable: false
  });

  return new Promise((resolve, reject) => {
    fileStream.on('error', (err) => {
      reject(err);
    });

    fileStream.on('finish', () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileUpload.name}`;
      resolve(publicUrl);
    });

    fileStream.end(file.buffer);
  });
};

const splitAudioIntoSegments = async (filePath) => {
  const audioSegments = [];

  const audioData = fs.readFileSync(filePath);
  const audioLength = audioData.length;
  const segmentSize = 16000 * 2;

  for (let i = 0; i < audioLength; i += segmentSize) {
    const segment = audioData.slice(i, i + segmentSize);
    audioSegments.push(segment);
  }

  return audioSegments;
};

app.post('/upload-video', upload.single('videoFile'), async (req, res) => {
  try {
    const fileUrl = await uploadFileToGCS(req.file);
    console.log('File uploaded to Google Cloud Storage:', fileUrl);

    const outputPath = `gs://${bucketName}/output.mp3`;

    await new Promise((resolve, reject) => {
      ffmpeg(req.file.buffer)
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

    const client = new SpeechClient(
      {
        projectId: "summary-master-sdp", // Replace with your Google Cloud project ID
        credentials: JSON.parse(process.env.SPEECH_TO_TEXT_KEYFILE)
      }
    );

    const [response] = await client.recognize({
      audio: { uri: outputPath },
      config: {
        encoding: 'MP3',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true
      }
    });

    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    console.log('Transcription:', transcription);

    res.json({ textContent: transcription });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to process the video file' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
