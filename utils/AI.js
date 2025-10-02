/**
 * utils/AI.js
 * Professional AI Utility Module
 * ---------------------------------------
 * پشتیبانی از چندین سرویس هوش مصنوعی:
 * - OpenAI (ChatGPT API)
 * - HuggingFace Inference API
 * - Local Models (مانند ollama یا هر سرویس داخلی)
 * 
 * استفاده:
 * const AI = require("../utils/AI");
 * const response = await AI.ask("سلام، حالت چطوره؟");
 */

const axios = require("axios");

// ====== محیط‌ها (OpenAI, HuggingFace, Local) ======
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const LOCAL_AI_ENDPOINT = process.env.LOCAL_AI_ENDPOINT || "http://localhost:11434/api/generate";

// ====== هسته‌ی AI ======
class AI {
    /**
     * متد اصلی پرسش از AI
     * @param {string} prompt - متن ورودی کاربر
     * @param {object} options - تنظیمات (model, provider, temperature, maxTokens)
     * @returns {Promise<string>}
     */
    static async ask(prompt, options = {}) {
        const provider = options.provider || process.env.AI_PROVIDER || "openai";

        switch (provider.toLowerCase()) {
            case "openai":
                return await this.askOpenAI(prompt, options);
            case "huggingface":
                return await this.askHuggingFace(prompt, options);
            case "local":
                return await this.askLocalModel(prompt, options);
            default:
                throw new Error(`❌ AI Provider '${provider}' not supported.`);
        }
    }

    // ====== OpenAI ======
    static async askOpenAI(prompt, options = {}) {
        if (!OPENAI_API_KEY) throw new Error("❌ Missing OPENAI_API_KEY in .env");

        const model = options.model || "gpt-3.5-turbo";
        const temperature = options.temperature || 0.7;
        const maxTokens = options.maxTokens || 200;

        const url = "https://api.openai.com/v1/chat/completions";
        const headers = {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
        };

        const body = {
            model,
            messages: [{ role: "user", content: prompt }],
            temperature,
            max_tokens: maxTokens,
        };

        const res = await axios.post(url, body, { headers });
        return res.data.choices[0].message.content.trim();
    }

    // ====== HuggingFace ======
    static async askHuggingFace(prompt, options = {}) {
        if (!HUGGINGFACE_API_KEY) throw new Error("❌ Missing HUGGINGFACE_API_KEY in .env");

        const model = options.model || "gpt2";
        const url = `https://api-inference.huggingface.co/models/${model}`;

        const headers = { Authorization: `Bearer ${HUGGINGFACE_API_KEY}` };
        const body = { inputs: prompt };

        const res = await axios.post(url, body, { headers });
        if (Array.isArray(res.data) && res.data[0]?.generated_text) {
            return res.data[0].generated_text.trim();
        }
        return JSON.stringify(res.data);
    }

    // ====== Local AI Model ======
    static async askLocalModel(prompt, options = {}) {
        const url = LOCAL_AI_ENDPOINT;

        const body = { prompt };
        const res = await axios.post(url, body);

        if (res.data?.response) {
            return res.data.response.trim();
        }
        return JSON.stringify(res.data);
    }
}

module.exports = AI;
