# ใช้ Node.js 20
FROM node:20

# ตั้ง working directory
WORKDIR /app

# คัดลอกไฟล์ package.json และ package-lock.json
COPY package*.json ./

# ติดตั้ง dependencies
RUN npm install

# คัดลอกไฟล์โปรเจคทั้งหมดเข้ามา
COPY . .

# เปิดพอร์ต 5174 (พอร์ตที่ Vite ใช้)
EXPOSE 5173

# คำสั่งรันเซิร์ฟเวอร์ (dev server)
CMD ["npm", "run", "dev", "--", "--host"]
