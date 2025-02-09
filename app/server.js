require("log-timestamp");

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcodeTerminal = require("qrcode-terminal");
const qrcode = require("qrcode");
const express = require("express");
const basicAuth = require("express-basic-auth");
const axios = require("axios");
const pino = require("pino");
require("dotenv").config();

const logger = pino({
  level: "info", // Set the desired logging level
  transport: {
    target: "pino-pretty", // Use pino-pretty for human-readable output
    options: {
      translateTime: "SYS:yyyy-mm-dd'T'HH:MM:ss.l'Z'",
    },
  },
});

const BACKEND_API_SCHEME = process.env.BACKEND_API_SCHEME || "http";
const BACKEND_API_HOST = process.env.BACKEND_API_HOST || "127.0.0.1";
const BACKEND_API_PORT = parseInt(process.env.BACKEND_API_PORT) || "5050";
const PORT = parseInt(process.env.PORT) || "80";

const BACKEND_API_URL = `${BACKEND_API_SCHEME}://${BACKEND_API_HOST}:${BACKEND_API_PORT}`;

logger.debug("BACKEND_API_SCHEME: " + BACKEND_API_SCHEME);
logger.debug("BACKEND_API_HOST: " + BACKEND_API_HOST);
logger.debug("BACKEND_API_PORT: " + BACKEND_API_PORT);
logger.info("BACKEND_API_URL: " + BACKEND_API_URL);

const app = express();
let receivedQr = null;
let clientInitialized = false;
let chatId = null;
let wid = null;
let client;

// Load authentication credentials from environment variables
const AUTH_USERNAME = process.env.QR_AUTH_USERNAME;
const AUTH_PASSWORD = process.env.QR_AUTH_PASSWORD;

if (!AUTH_USERNAME || !AUTH_PASSWORD) {
  console.error("ERROR: Missing authentication credentials. Set QR_AUTH_USERNAME and QR_AUTH_PASSWORD in .env")
  process.exit(1);
}
// Express Basic Authentication Middleware
app.use(
  basicAuth({
    users: { [AUTH_USERNAME]: AUTH_PASSWORD },
    challenge: true,
    unauthorizedResponse: "Unauthorized Access",
  })
);

const checkHealth = async () => {
  try {
    const response = await axios.get(BACKEND_API_URL + "/health");
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
    logger.error(error.message, "Could not get backend API health status");
    return false;
  }
};

// wwebjs configuration
try {
  client = new Client({
    puppeteer: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
    authStrategy: new LocalAuth({ dataPath: "data/.wwebjs_auth/" }),
    webVersionCache: { path: "data/.wwebjs_cache/" },
  });

  // show qr code in console
  client.on("qr", (qr) => {
    logger.info(`Received QR-code: ${qr}`);
    receivedQr = qr;
    qrcodeTerminal.generate(qr, { small: true });
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
    checkHealth();
  });

  client.initialize();
} catch (error) {
  console.error("Failed to initialize the client:", error);
  return;
}

client.on("message_create", async (message) => {
  chatId = message.from;
  if (wid == chatId) return;

  console.log("New message from:", chatId);
  if (chatId.startsWith("49")) {
    console.log("Message is from German number.");
  } else {
    console.log("Message is from a foreign number, aborting");
    return; 
  }
  const chat = await client.getChatById(chatId);
  const messages = await chat.fetchMessages({ limit: 100 });

  const messagesData = messages.map((msg) => ({
    from: msg.from === wid ? "assistant" : msg.from,
    body: msg.body,
    timestamp: msg.timestamp,
  }));

  const lastMessage = messagesData[messagesData.length - 1]; 
  const history = messagesData
    .slice(0, messagesData.length - 1)
    .filter((msg) => msg.body !== lastMessage.body);

  const payload = {
    chatId: chatId,
    history: history,
    lastMessage: lastMessage,
  };
  logger.info({ payload }, "Payload");

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

app.get("/qr", async (req, res) => {
  if(clientInitialized) {
    return res.status(200).send("Client is already signed in.")
  }

  if (!receivedQr) {
    return res.status(500).send("QR Code not available yet. Please try again.");
  }

  try {
    const qrImage = await qrcode.toDataURL(receivedQr);
    res.send(`
      <html>
      <head>
        <title>WhatsApp Web QR Code</title>
        <meta http-equiv="refresh" content="1"> <!-- Refresh every 1 second -->
        <script>
          setTimeout(() => {
            window.location.reload();
          }, 1000); // JavaScript auto-refresh every second
        </script>
      </head>
      <body style="text-align: center;">
        <h2>Scan the QR Code to Log In</h2>
        <img src="${qrImage}" alt="QR Code" />
        <p>Refreshing every second to keep the QR code updated.</p>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send("Failed to generate QR code image.");
  }
});

// Start the Web Server
app.listen(PORT, () => {
  logger.info(`QR Code server running at http://localhost:${PORT}`);
});