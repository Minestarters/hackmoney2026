import type { Request, Response } from 'express';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import { PinataSDK } from 'pinata';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Pinata Client Setup
const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT || '',
  pinataGateway: process.env.PINATA_GATEWAY || '',
});

app.post('/upload', upload.array('files'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      res.status(400).json({ error: 'No files provided' });
      return;
    }

    const files = req.files as Express.Multer.File[];
    const uploadResults = [];

    for (const fileData of files) {
      try {
        const file = new File([new Uint8Array(fileData.buffer)], fileData.originalname, {
          type: fileData.mimetype,
        });

        console.log(`Uploading ${fileData.originalname} to Pinata...`);

        const uploadResult = await pinata.upload.public.file(file);
        const cid = uploadResult.cid;
        const url = `https://${process.env.PINATA_GATEWAY}/ipfs/${cid}`;

        uploadResults.push({
          fileName: fileData.originalname,
          cid: cid,
          url: url,
        });
      } catch (fileError: any) {
        console.error(`Failed to upload ${fileData.originalname}:`, fileError);
        uploadResults.push({
          fileName: fileData.originalname,
          cid: '',
          url: '',
        });
      }
    }

    res.json({
      success: uploadResults.length > 0,
      uploads: uploadResults,
    });
  } catch (error: any) {
    console.error("Pinata Upload Error:", error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

app.get('/:cid', async (req: Request, res: Response): Promise<void> => {
  const { cid } = req.params;
  try {
    // This fetches the file data through your dedicated gateway
    const response = await pinata.gateways.public.get(cid as string || '');

    // If you want to redirect the browser to the file:
    const gatewayUrl = `https://${process.env.PINATA_GATEWAY}/ipfs/${cid}`;
    res.redirect(gatewayUrl);
  } catch (error: any) {
    res.status(404).json({ error: "File not found or gateway error" });
  }
});;

app.get('/proxy/:cid', async (req: Request, res: Response): Promise<void> => {
  const { cid } = req.params;
  try {
    const { data, contentType } = await pinata.gateways.public.get(cid as string || '');

    res.setHeader('Content-Type', contentType || 'application/octet-stream');

    const buffer = Buffer.from(await (data as any).arrayBuffer());
    res.send(buffer);
  } catch (error: any) {
    res.status(404).json({ error: "Could not proxy file" });
  }
});

app.listen(port, () => {
  console.log(`⚡ Server running at http://localhost:${port}`);
  console.log(`   Gateway: ${process.env.PINATA_GATEWAY}`);
});