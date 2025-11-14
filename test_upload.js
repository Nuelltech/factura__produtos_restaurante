import fs from "fs";
import FormData from "form-data";
import fetch from "node-fetch";

const API_URL = "https://factura-produtos-restaurante.onrender.com/process-fatura";

// Caminho para o ficheiro de teste (imagem ou PDF da fatura)
const filePath = "./fatura_teste.pdf";

async function testUpload() {
  try {
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));

    const response = await fetch(API_URL, {
      method: "POST",
      body: form,
    });

    const data = await response.json();
    console.log("Resposta da API:", data);
  } catch (err) {
    console.error("Erro no teste:", err);
  }
}

testUpload();
