import express from "express";
import fetch from "node-fetch";
import { OpenAI } from "openai";
import cors from "cors";
import dotenv from "dotenv";
import Tesseract from "tesseract.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

app.post("/process-fatura", async (req, res) => {
  try {
    const { fileUrl } = req.body;

    if (!fileUrl) {
      return res.status(400).json({ error: "fileUrl é obrigatório." });
    }

    console.log("📥 Recebido fileUrl:", fileUrl);

    // 1️⃣ Baixar a imagem
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok) {
      return res.status(400).json({ error: "Falha ao descarregar o ficheiro." });
    }

    const arrayBuffer = await fileResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log("📄 Fatura descarregada com sucesso.");

    // 2️⃣ OCR com Tesseract
    console.log("🔍 A processar OCR...");
    const { data: { text: ocrText } } = await Tesseract.recognize(buffer, "por", {
      logger: m => console.log(m)
    });
    console.log("📝 OCR concluído.");

    // 3️⃣ Enviar texto ao OpenAI para extrair JSON
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
Tu és um extrator de dados de faturas.
Responde SOMENTE com JSON válido.
Não acrescentes explicações nem blocos de código.
Se não conseguires extrair algo, coloca null.
A estrutura deve ser:

{
  "supplier_description": "",
  "supplier_code": "",
  "purchase_date": "",
  "items": [
    {
      "description": "",
      "qty": 0,
      "unit_supplier": "",
      "price_unit": 0,
      "price_total": 0,
      "vat_rate": ""
    }
  ]
}
`
        },
        {
          role: "user",
          content: ocrText
        }
      ]
    });

    const text = completion.choices?.[0]?.message?.content;

    // 4️⃣ Garantir que é JSON válido
    try {
      const parsed = JSON.parse(text);
      return res.json(parsed);
    } catch (err) {
      console.log("⚠️ Modelo não devolveu JSON válido:", text);
      return res.status(500).json({ error: "Falha ao parsear JSON", raw_output: text });
    }

  } catch (error) {
    console.error("❌ Erro geral:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor a correr na porta ${PORT}`));

