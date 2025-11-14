import express from "express";
import multer from "multer";
import fs from "fs";
import OpenAI from "openai";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

const client = new OpenAI({
    apiKey: process.env.OPENAI_KEY,
});

// Conexão MySQL
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: process.env.MYSQL_DB,
});

// Endpoint principal
app.post("/process-fatura", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Ficheiro não enviado" });
        }

        const filePath = req.file.path;
        const fileData = fs.readFileSync(filePath);

        const aiResponse = await client.chat.completions.create({
            model: "gpt-4.1-preview",
            messages: [
                { role: "system", content: "Extrai dados de faturas e devolve JSON válido." },
                {
                    role: "user",
                    content: [
                        { type: "input_file", data: fileData, name: req.file.originalname },
                        { type: "text", text: "Extrai fornecedor, NIF, data, número de fatura, items, subtotal, IVA, total." }
                    ]
                }
            ]
        });

        const jsonText = aiResponse.choices[0].message.content;
        const json = JSON.parse(jsonText);

        // Inserir na tabela staging
        const sql = `
            INSERT INTO staging_faturas
            (fornecedor, nif, data_fatura, numero_fatura, items_json, total)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        await pool.execute(sql, [
            json.fornecedor,
            json.nif,
            json.data,
            json.numero,
            JSON.stringify(json.items),
            json.total,
        ]);

        fs.unlinkSync(filePath); // apaga ficheiro

        res.json({ status: "ok", data: json });

    } catch (err) {
        console.error("Erro no processamento:", err);
        res.status(500).json({ error: err.message });
    }
});

// A porta é definida automaticamente pelo Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado na porta ${PORT}`));
