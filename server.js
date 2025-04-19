require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Client } = require('@elastic/elasticsearch');

const app = express();
app.use(cors());
app.use(express.json());

const esClient = new Client({
  node: 'http://localhost:9200',
  auth: {
    username: 'elastic',
    password: '046936864'
  }
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = "text-embedding-3-small";
const COMPLETION_MODEL = "gpt-3.5-turbo";

async function getEmbedding(text) {
  const res = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      input: text,
      model: EMBEDDING_MODEL
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return res.data.data[0].embedding;
}

async function getAnswerFromOpenAI(context, question) {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: COMPLETION_MODEL,
      messages: [
        { role: "system", content: "אתה עוזר אישי חכם בשם מרטין." },
        { role: "user", content: `בהתבסס על המידע הבא:
${context}
ענה לשאלה:
${question}` }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return res.data.choices[0].message.content;
}

app.post('/martin/query', async (req, res) => {
  const { user, question } = req.body;
  if (!user || !question) {
    return res.status(400).json({ error: 'Missing user or question' });
  }

  try {
    const vector = await getEmbedding(question);

    const result = await esClient.search({
      index: 'martin-dialogs',
      knn: {
        field: 'embedding',
        k: 5,
        num_candidates: 20,
        query_vector: vector
      }
    });

    const context = result.hits.hits.map(hit => hit._source.memory).join('\n---\n');
    const answer = await getAnswerFromOpenAI(context, question);

    // Save answer to elastic for future learning
    await esClient.index({
      index: 'martin-dialogs',
      document: {
        user,
        memory: answer,
        embedding: await getEmbedding(answer),
        timestamp: new Date().toISOString(),
        source: "ai"
      }
    });

    res.json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

app.listen(8080, () => {
  console.log('✅ Semantic Martin Proxy running on port 8080');
});