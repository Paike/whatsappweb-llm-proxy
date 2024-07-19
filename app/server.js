const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const axios = require("axios");

console.log("API_URL: "+process.env.API_URL)

let api_url = process.env.API_URL || "http://127.0.0.1:5050/api"
api_url = api_url.replace(/\/$/, "");

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
// show qr code in console
client.on("qr", (qr) => {
  console.log("QR RECEIVED", qr);
  receivedQr = qr;
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  clientInitialized = true;
  console.log("Client is ready!");
  try {
    wid = client.info.wid._serialized; // Get the serialized ID of the logged-in user
    console.log(`Logged in as ${wid}`);
  } catch (error) {
    console.error("Error getting account info:", error);
  }  
});

client.initialize();

client.on("message_create", async (message) => {
  chatId = message.from;
  if(wid == chatId) return;

  const chat = await client.getChatById(chatId);

  const messages = await chat.fetchMessages({ limit: 100 }); // Adjust the limit as needed.

  // Prepare messages data
  const messagesData = messages.map((msg) => ({
    from: msg.from === wid ? 'assistant' : msg.from, // Change 'from' to 'assistant' if it's the logged-in user
    body: msg.body,
    timestamp: msg.timestamp,
  }));
  // Prepare history array
  const history = messagesData.slice(0, messagesData.length - 1); // Exclude the last message

  // Prepare lastMessage object
  const lastMessage = messagesData[messagesData.length - 1]; // Get the last message

  // Prepare payload
  const payload = {
    chatId: chatId,
    history: history,
    lastMessage: lastMessage
  };

  console.log(payload)
  // Send data to python backend
  try {
    console.log("sending payload")
    const response = await axios.post(
      api_url + "/inference",
      payload
    );
    client.sendMessage(message.from, response.data);
    console.log("Data sent to backend:", response.data);
  } catch (error) {
    console.error("Error sending data to backend:", error);
  }
  
});
