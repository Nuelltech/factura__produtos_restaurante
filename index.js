import express from "express";
import fetch from "node-fetch";
import mysql from "mysql2/promise";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para JSON
app.use(express.json());

// Configuração do OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configuração MySQL
const db = await mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Endpoint principal
app.post("/process-fatura", async (req, res) => {
  try {
    const { fileUrl } = req.body;

    if (!fileUrl || fileUrl === "null") {
      return res.status(400).json({ error: "Parâmetro 'fileUrl' não fornecido" });
    }

    // Buscar a imagem via URL
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error("Erro ao buscar a imagem do URL");
    const buffer = await response.arrayBuffer();
    const base64Image = Buffer.from(buffer).toString("base64");

    // Chamada ao OpenAI GPT-4 multimodal (exemplo de OCR/fatura)
    const openaiResponse = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extrai os dados desta fatura." },
            { type: "image_base64", image_base64: base64Image }
          ]
        }
      ]
    });

    // Podes guardar resultado no MySQL se quiseres
    // const query = "INSERT INTO faturas (file_url, resposta) VALUES (?, ?)";
    // await db.execute(query, [fileUrl, JSON.stringify(openaiResponse)]);

    res.json({
      status: "ok",
      data: openaiResponse
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

