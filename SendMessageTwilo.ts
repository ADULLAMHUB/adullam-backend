import 'dotenv/config';
import twilo from "twilio";
const accountSid = process.env.TWILO_ACCOUNTSID;
const authToken = process.env.TWILO_AUTHTOKEN;
const client = twilo(accountSid, authToken);
async function SendMessages() {
  try {
    const message = await client.messages.create({
      from: "whatsapp:+14155238886",
      to: "whatsapp:+2348023134756",
      body: "Welcome to Adullam Hub, Hello Sean how far now",
    });
    console.log(message.sid);
  } catch (error) {
    console.error(error);
  }
}

SendMessages();
