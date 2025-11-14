import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Inicializar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY
});

// Endpoint
app.post("/process-fatura", async (req, res) => {
  try {
    const { fileUrl } = req.body;

    if (!fileUrl || typeof fileUrl !== "string") {
      return res.status(400).json({ error: "Parâmetro 'fileUrl' é obrigatório." });
    }

    console.log("📥 Recebido fileUrl:", fileUrl);

    // Verificar se a URL é acessível
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok) {
      return res.status(400).json({ error: "Não foi possível acessar o fileUrl." });
    }

    console.log("📄 Fatura acessível.");

    // Chamada à OpenAI Responses API
    const aiResponse = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { type: "input_image", image_url: fileUrl },
        {
          type: "input_text",
          text: `
Tu és um extrator de dados de faturas.
RESPEITA ESTRITAMENTE:

-> Responde apenas com JSON válido.
-> Sem explicações, sem texto antes ou depois.
-> Se não conseguires extrair algo, usa null.
-> Estrutura obrigatória:
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
        }
      ]
    });

    const text = aiResponse.output_text ?? "";

    try {
      const parsed = JSON.parse(text);
      return res.json(parsed);
    } catch (err) {
      console.warn("⚠️ Falha ao parsear JSON retornado pelo modelo.");
      return res.status(500).json({ error: "Falha ao parsear JSON da AI.", raw: text });
    }

  } catch (err) {
    console.error("❌ Erro no processamento:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor a correr na porta ${PORT}`));
