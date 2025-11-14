import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { OpenAI } from "openai";

const app = express();
app.use(cors());
app.use(express.json());

// Inicializar OpenAI com a env do Render
const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY
});

app.post("/process-fatura", async (req, res) => {
  try {
    const { fileUrl } = req.body;

    if (!fileUrl) {
      return res.status(400).json({ error: "fileUrl é obrigatório." });
    }

    console.log("📥 Recebido fileUrl:", fileUrl);

    // 1️⃣ Baixar a imagem do Retool Filepicker
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok) {
      return res.status(400).json({ error: "Falha ao descarregar o ficheiro." });
    }

    const arrayBuffer = await fileResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log("📄 Fatura descarregada com sucesso.");

    // 2️⃣ Enviar a imagem para o modelo
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
Tu és um extrator de dados de faturas.
SEGUE ESTRITAMENTE AS REGRAS:

-> Responde SOMENTE com um JSON VÁLIDO.
-> Não acrescentes explicações.
-> Não coloques texto antes ou depois.
-> Não uses \`\`\`.
-> Se não conseguires extrair algo, usa null.
-> A resposta DEVE ter esta estrutura:

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
          content: [
            {
              type: "input_image",
              image: buffer,       // IMAGEM BINÁRIA
              mime_type: "image/jpeg"  // OU image/png
            }
          ]
        }
      ]
    });

    console.log("🧠 OpenAI respondeu.");

    let text = result.choices?.[0]?.message?.content;

    // Garantir que é JSON válido
    try {
      const parsed = JSON.parse(text);
      return res.json(parsed);
    } catch (e) {
      console.log("⚠️ Modelo devolveu algo que não é JSON. Fez fallback.");
      return res.json({ raw_output: text });
    }

  } catch (error) {
    console.error("❌ Erro geral:", error);
    res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor a correr na porta ${PORT}`);
});

