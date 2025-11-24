# Ethereum Live Monitor (React + Vite + Wagmi + RainbowKit)

This project is a **single-page React application** built using **Vite**, showcasing live real-time data from the Ethereum blockchain.  
It demonstrates:

- Connecting a wallet using **RainbowKit** + **Wagmi**
- Listening to **Pending Transactions** in real-time
- Listening to **New Blocks** in real-time
- Displaying live blockchain data in a modern dark-mode UI
- Clean and responsive frontend components

---

## ✨ Features

### 🔗 Wallet Connection
- Connect wallet using **RainbowKit** (MetaMask, Coinbase Wallet, WalletConnect, and more).
- Powered by **Wagmi**, providing hooks and connectors for React apps.
- Entire app content unlocks only when the user is connected.

### ⚡ Live Blockchain Streams
The application listens to two real-time feeds through a WebSocket provider:

#### 1. Pending Transactions Listener
- Starts or stops listening via button
- Displays live incoming Pending Transaction hashes
- Provides a total counter
- Includes a scrollable list with clickable links to Etherscan

#### 2. New Blocks Listener
- Starts or stops listening via button
- Displays live new blocks with:
  - Block number (linked to Etherscan)
  - Total number of transactions
  - Timestamp (converted to readable datetime)
- Includes a scrollable table-style list

### 🎨 Modern Dark UI
- Custom design with neon accents
- Two split sections for Txns and Blocks
- Clean typography and layout

---

## 📚 Libraries Used

### 🔵 Wagmi
Wagmi provides a set of powerful React hooks for interacting with Ethereum.

[Documentation: ](https://wagmi.sh/) 


### 🌈 RainbowKit
RainbowKit provides beautiful out-of-the-box wallet connection components.

[Documentation:  ](https://www.rainbowkit.com/)


### 🟢 Viem
Used for:
- Connecting to Ethereum via WebSocket
- Watching pending transactions
- Watching new blocks

[Documentation:](https://viem.sh/)  

---

# 📁 Project Structure
src/
 ├─ App.jsx          → main application logic
 ├─ main.jsx         → React + RainbowKit + Wagmi setup
 └─ index.css        → modern dark UI styling

## 🚀 Getting Started

Follow these instructions to run the project locally.

### 1. Clone the repository
```bash
git clone https://github.com/Shinwari536/ethereum-live-monitor
cd ethereum-live-monitor
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure your WebSocket RPC
- Inside `/src/App.js` assign correct websocket RPC url to `WS_URL`

### 4. Run the development server
```bash
npm run dev
```