const express = require('express');
const multer = require('multer');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { Storage } = require('@google-cloud/storage');
const { SpeechClient } = require('@google-cloud/speech').v1;
const cors = require('cors');

const storage = new Storage({
  projectId: "summary-master-sdp",
  credentials: JSON.parse(process.env.CLOUD_STORAGE_KEYFILE)
});
const bucketName = 'summary-master'; // Replace with your bucket name

const app = express();
const port = process.env.PORT || 8001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

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
      const publicUrl = `https://storage.cloud.google.com/${bucket.name}/${fileUpload.name}`;
      resolve(publicUrl);
    });

    fileStream.end(file.buffer);
  });
};

const convertVideoToMP3 = async (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
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
};

const transcribeAudio = async (gcsUri) => {
  const client = new SpeechClient({
    projectId: "summary-master-sdp", // Replace with your Google Cloud project ID
    credentials: JSON.parse(process.env.SPEECH_TO_TEXT_KEYFILE)
  });

  const audio = {
    uri: gcsUri, // Use the GCS URI directly
  };

  const config = {
    encoding: 'MP3',
    sampleRateHertz: 16000,
    languageCode: 'en-US',
    enableAutomaticPunctuation: true
  };

  const [response] = await client.recognize({ audio, config });
  const transcription = response.results
    .map(result => result.alternatives[0].transcript)
    .join('\n');

  console.log('Transcription:', transcription);
  return transcription;
};

app.post('/upload-video', upload.single('videoFile'), async (req, res) => {
  try {
    const fileUrl = await uploadFileToGCS(req.file);
    console.log('File uploaded to Google Cloud Storage:', fileUrl);

    const localVideoPath = `/tmp/${req.file.originalname}`;
    const outputPath = `/tmp/output.mp3`;

    // Write the file to the local disk
    fs.writeFileSync(localVideoPath, req.file.buffer);

    // Convert video to MP3 format
    await convertVideoToMP3(localVideoPath, outputPath);
    console.log('Audio file created:', outputPath);

    // Upload the output audio file to Google Cloud Storage
    const audioUrl = await uploadFileToGCS({ originalname: 'output.mp3', buffer: fs.readFileSync(outputPath) });

    // Transcribe audio to text
    const transcription = await transcribeAudio(audioUrl);

    // Delete the local video and audio files
    fs.unlinkSync(localVideoPath);
    fs.unlinkSync(outputPath);

    // Send transcription in response
    res.json({ textContent: transcription });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to process the video file' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
