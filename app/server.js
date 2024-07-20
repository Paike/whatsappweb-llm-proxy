const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
// const express = require("express");
const axios = require("axios");
const pino = require("pino");
require("dotenv").config();

const logger = pino({
  level: "info", // Set the desired logging level
  transport: {
    target: "pino-pretty", // Use pino-pretty for human-readable output
  },
});

const BACKEND_API_SCHEME = process.env.BACKEND_API_SCHEME || "http";
const BACKEND_API_HOST = process.env.BACKEND_API_HOST || "127.0.0.1";
const BACKEND_API_PORT = parseInt(process.env.BACKEND_API_PORT) || "5050";

const BACKEND_API_URL = `${BACKEND_API_SCHEME}://${BACKEND_API_HOST}:${BACKEND_API_PORT}`;

logger.debug("BACKEND_API_SCHEME: " + BACKEND_API_SCHEME);
logger.debug("BACKEND_API_HOST: " + BACKEND_API_HOST);
logger.debug("BACKEND_API_PORT: " + BACKEND_API_PORT);
logger.info("BACKEND_API_URL: " + BACKEND_API_URL);

// wwebjs configuration
const client = new Client({
  puppeteer: {
    args: ["--no-sandbox"],
  },
  authStrategy: new LocalAuth({ dataPath: "data/.wwebjs_auth/" }),
  webVersionCache: { path: "data/.wwebjs_cache/" },
});

let receivedQr = null;
let clientInitialized = false;
let chatId = null;
let wid = null;

// health check backend


const checkHealth = async () => {
  try {
    const response = await axios.get(BACKEND_API_URL + "/healthcheck");
    const healthStatus = response.data;

    logger.info(healthStatus, "Backend API health status");
    // Example: Checking the status and acting upon it
    if (healthStatus.status === "OK") {
      logger.info("Backend API is healthy.");
      return true;
    } else {
      logger.error("Backend API is not healthy.");
      return false;
    }

    // Additional checks can be performed based on the response
    if (healthStatus.dependencies.inference_server === "FAIL") {
      console.log("Database connection failed");
    }
    // Handle other dependencies and statuses as needed
  } catch (error) {
    logger.error(`Could not get backend API health status: ${error.message}`);
    return false;
  }
};

checkHealth();

// show qr code in console
client.on("qr", (qr) => {
  logger.info(`Received QR-code: ${qr}`);
  receivedQr = qr;
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  clientInitialized = true;
  logger.info("Client is ready");
  try {
    wid = client.info.wid._serialized; // Get the serialized ID of the logged-in user
    logger.info(`Logged in as ${wid}`);
  } catch (error) {
    logger.error(`Error getting account info: ${error}`);
  }
});

client.initialize();

client.on("message_create", async (message) => {
  chatId = message.from;
  if (wid == chatId) return;

  const chat = await client.getChatById(chatId);

  const messages = await chat.fetchMessages({ limit: 100 }); // Adjust the limit as needed.

  // Prepare messages data
  const messagesData = messages.map((msg) => ({
    from: msg.from === wid ? "assistant" : msg.from, // Change 'from' to 'assistant' if it's the logged-in user
    body: msg.body,
    timestamp: msg.timestamp,
  }));
  // Prepare lastMessage object
  const lastMessage = messagesData[messagesData.length - 1]; // Get the last message = the new message

   // Filter out previous messages with the same body as the new message
   const history = messagesData.slice(0, messagesData.length - 1) // Exclude the last message
   .filter(msg => msg.body !== lastMessage.body);

  // Prepare payload
  const payload = {
    chatId: chatId,
    history: history,
    lastMessage: lastMessage,
  };
  logger.info({payload}, "Payload");
  
  // Send data to python backend
  try {
    logger.info("Sending message to backend");
    const response = await axios.post(BACKEND_API_URL + "/inference", payload);
    client.sendMessage(message.from, response.data);
    logger.info(`Received from backend: ${response.data}`);
  } catch (error) {
    logger.error(`Error sending data to backend: ${error}`);
  }
});
process.on("SIGINT", async () => {
  logger.info("(SIGINT) Shutting down...");
  await client.destroy();
  process.exit(0);
});
