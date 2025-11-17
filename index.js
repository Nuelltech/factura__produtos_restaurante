import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

// Inicializar OpenAI
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ------------------------------
// Função multimodal corrigida
// ------------------------------
async function extractInvoiceDataFromImageUrl(imageUrl) {
  try {
    console.log("📥 A fazer download da imagem...");

    // 1. Download da imagem
    const imgResponse = await fetch(imageUrl);
    const imgBuffer = await imgResponse.arrayBuffer();
    const imgBase64 = Buffer.from(imgBuffer).toString("base64");

    console.log("📤 Imagem convertida para base64. Enviando à OpenAI...");

    // 2. Chamada correta usando input_image
    const response = await client.responses.create({
      model: "gpt-4.1-preview",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
Extrai esta fatura e devolve APENAS o seguinte JSON, sem texto adicional:

{
  "invoiceNumber": "",
  "invoiceDate": "",
  "supplierName": "",
  "supplierNIF": "",
  "items": [
    {
      "productName": "",
      "productCode": "",
      "quantity": "",
      "unitPrice": "",
      "totalPrice": ""
    }
  ],
  "invoiceTotal": ""
}

Se não encontrares um campo, deixa-o em branco.
`
            },
            {
              type: "input_image",
              image_url: `data:image/png;base64,${imgBase64}`
            }
          ]
        }
      ]
    });

    console.log("📤 Resposta recebida da OpenAI.");

    // Extrair texto gerado
    const output = response.output_text;
    return output;

  } catch (err) {
    console.error("❌ Erro na extração multimodal:", err);
    throw err;
  }
}

// -------------------------------------------------
// Endpoint principal /extract
// -------------------------------------------------
app.post("/process-fatura", async (req, res) => {
  try {
    const { fileUrl } = req.body;

    if (!fileUrl) {
      return res.status(400).json({ error: "fileUrl obrigatório" });
    }

    console.log("📥 Recebido fileUrl:", fileUrl);

    const extracted = await extractInvoiceDataFromImageUrl(fileUrl);
    return res.json({ success: true, extracted });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Erro desconhecido"
    });
  }
});

// ------------------------------
app.listen(3000, () => {
  console.log("Servidor ativo na porta 3000");
});
