import mqtt from "mqtt";

const client = mqtt.connect("mqtt://192.168.10.6:1883");

client.on("connect", () => {
  console.log("✅ Connected to MQTT broker");
  client.subscribe("#"); // subscribe ทุก topic
});

client.on("message", (topic, message) => {
  console.log(`📡 ${topic}: ${message.toString()}`);
});
