# Whatsapp Web LLM Proxy

This node.js script will connect to Whatsapp Web and forward messages to the LLM backend.

The QR code will be available at localhost:$PORT/qr

Define environment variables:

`BACKEND_API_SCHEME` https or http
`BACKEND_API_HOST` the ip or hostname of the backend server
`BACKEND_API_PORT` listening port of the backend
`QR_AUTH_USERNAME` User name for accessing the QR code
`QR_AUTH_PASSWORD` Password for accessing the QR code
