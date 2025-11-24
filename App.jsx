const WS_URL = "wss://eth.drpc.org";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { createPublicClient, webSocket } from "viem";
import { mainnet } from "viem/chains";
import { useState, useRef, useEffect } from "react";

export default function App() {
  const { address, isConnected } = useAccount();

  // Pending Transactions
  const [pendingTxs, setPendingTxs] = useState([]);
  const [listeningTx, setListeningTx] = useState(false);
  const [txCount, setTxCount] = useState(0);
  const [buyCount, setBuyCount] = useState(0);
  const [sellCount, setSellCount] = useState(0);
  const [analyzedCount, setAnalyzedCount] = useState(0);
  const txClientRef = useRef(null);
  const txQueueRef = useRef([]);
  const isProcessingRef = useRef(false);

  // New Blocks
  const [blocks, setBlocks] = useState([]);
  const [listeningBlocks, setListeningBlocks] = useState(false);
  const [blockCount, setBlockCount] = useState(0);
  const blockClientRef = useRef(null);

  // Calculate dominance
  const totalOrders = buyCount + sellCount;
  const buyPercentage = totalOrders > 0 ? ((buyCount / totalOrders) * 100).toFixed(1) : 0;
  const sellPercentage = totalOrders > 0 ? ((sellCount / totalOrders) * 100).toFixed(1) : 0;
  const dominance = buyCount > sellCount ? "BUY" : sellCount > buyCount ? "SELL" : "NEUTRAL";
  const analysisRate = txCount > 0 ? ((analyzedCount / txCount) * 100).toFixed(1) : 0;

  /** ---------------- Enhanced Transaction Analysis ---------------- **/
  const analyzeTxType = async (client, txHash) => {
    try {
      const tx = await client.getTransaction({ hash: txHash });
      
      if (!tx || !tx.input || tx.input.length <= 10) {
        return 'neutral';
      }

      const methodId = tx.input.slice(0, 10).toLowerCase();
      
      // CORRECTED LOGIC: Track ETH direction, not token direction
      // SELL = Selling ETH (ETH going OUT) = Bearish for ETH price
      // BUY = Buying ETH (ETH coming IN) = Bullish for ETH price
      
      const sellSignatures = [
        // Uniswap V2 & Forks - ETH going OUT
        '0x7ff36ab5', // swapExactETHForTokens - SELLING ETH
        '0xfb3bdb41', // swapETHForExactTokens - SELLING ETH
        '0xb6f9de95', // swapExactETHForTokensSupportingFeeOnTransferTokens - SELLING ETH
        // 1inch & Aggregators when ETH is input
        '0x7c025200', // swap (1inch v5) - check if ETH sent
        '0x12aa3caf', // swap (1inch v4) - check if ETH sent
      ];
      
      const buySignatures = [
        // Uniswap V2 & Forks - ETH coming IN
        '0x18cbafe5', // swapExactTokensForETH - BUYING ETH
        '0x4a25d94a', // swapTokensForExactETH - BUYING ETH
        '0x791ac947', // swapExactTokensForETHSupportingFeeOnTransferTokens - BUYING ETH
        // Uniswap V3
        '0xdb3e2198', // exactOutputSingle (when output is ETH)
        '0xf28c0498', // exactOutput (when output is ETH)
      ];

      // For generic swap methods, check if ETH value is sent
      const genericSwapSignatures = [
        '0x38ed1739', // swapExactTokensForTokens
        '0x8803dbee', // swapTokensForExactTokens
        '0x5c11d795', // swapExactTokensForTokensSupportingFeeOnTransferTokens
        '0x414bf389', // exactInputSingle (Uniswap V3)
        '0xc04b8d59', // exactInput (Uniswap V3)
        '0x5ae401dc', // multicall
        '0xac9650d8', // multicall
        '0xe449022e', // uniswapV3Swap
      ];

      if (sellSignatures.includes(methodId)) {
        return 'sell';
      } else if (buySignatures.includes(methodId)) {
        return 'buy';
      }

      // For generic swaps: if ETH value is sent, user is SELLING ETH
      if (genericSwapSignatures.includes(methodId)) {
        if (tx.value && tx.value > 0n) {
          return 'sell'; // ETH being sent = Selling ETH
        } else {
          return 'buy'; // No ETH sent = likely buying ETH with tokens
        }
      }

      // Additional heuristic: any contract call with ETH value = selling ETH
      if (tx.value && tx.value > 0n && tx.to) {
        return 'sell';
      }
      
      return 'neutral';
    } catch (err) {
      return 'neutral';
    }
  };

  /** ---------------- Queue-based Transaction Processing ---------------- **/
  const processTxQueue = async (client) => {
    if (isProcessingRef.current || txQueueRef.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;

    // Process transactions in batches
    const batchSize = 10;
    const batch = txQueueRef.current.splice(0, batchSize);

    try {
      // Process transactions in parallel with a slight delay to avoid rate limits
      const results = await Promise.all(
        batch.map(async (txHash, index) => {
          // Stagger requests slightly
          await new Promise(resolve => setTimeout(resolve, index * 50));
          return analyzeTxType(client, txHash);
        })
      );

      // Update counts based on results
      let buyInc = 0;
      let sellInc = 0;
      
      results.forEach(type => {
        if (type === 'buy') buyInc++;
        else if (type === 'sell') sellInc++;
      });

      setBuyCount(c => c + buyInc);
      setSellCount(c => c + sellInc);
      setAnalyzedCount(c => c + batch.length);

    } catch (err) {
      console.error('Error processing batch:', err);
    }

    isProcessingRef.current = false;

    // Continue processing if there are more transactions
    if (txQueueRef.current.length > 0) {
      setTimeout(() => processTxQueue(client), 100);
    }
  };

  const startPendingTx = async () => {
    if (listeningTx) return;
    setListeningTx(true);

    const client = createPublicClient({
      chain: mainnet,
      transport: webSocket(WS_URL),
    });

    txClientRef.current = client;

    const unsubscribe = client.watchPendingTransactions({
      onTransactions: async (txs) => {
        setTxCount((c) => c + txs.length);
        setPendingTxs((prev) => [...txs, ...prev].slice(0, 150));
        
        // Add transactions to queue for analysis
        txQueueRef.current.push(...txs);
        
        // Start processing queue
        processTxQueue(client);
      },
    });

    txClientRef.current.unsubscribe = unsubscribe;
  };

  const stopPendingTx = () => {
    if (txClientRef.current?.unsubscribe) txClientRef.current.unsubscribe();
    setListeningTx(false);
    txQueueRef.current = [];
    isProcessingRef.current = false;
  };

  const resetStats = () => {
    setBuyCount(0);
    setSellCount(0);
    setTxCount(0);
    setAnalyzedCount(0);
    setPendingTxs([]);
    txQueueRef.current = [];
    isProcessingRef.current = false;
  };

  /** ---------------- Block Listener ---------------- **/
  const startBlocks = async () => {
    if (listeningBlocks) return;
    setListeningBlocks(true);

    const client = createPublicClient({
      chain: mainnet,
      transport: webSocket(WS_URL),
    });

    blockClientRef.current = client;

    const unsubscribe = client.watchBlocks({
      includeTransactions: true,
      onBlock: (block) => {
        const totalTxs = block.transactions?.length || 0;
        const time = new Date(Number(block.timestamp) * 1000).toLocaleString();
        setBlockCount((c) => c + 1);
        setBlocks((prev) =>
          [
            {
              number: block.number,
              totalTxs,
              time,
            },
            ...prev,
          ].slice(0, 100)
        );
      },
    });

    blockClientRef.current.unsubscribe = unsubscribe;
  };

  const stopBlocks = () => {
    if (blockClientRef.current?.unsubscribe)
      blockClientRef.current.unsubscribe();
    setListeningBlocks(false);
  };

  /** Cleanup **/
  useEffect(() => {
    return () => {
      if (txClientRef.current?.unsubscribe) txClientRef.current.unsubscribe();
      if (blockClientRef.current?.unsubscribe)
        blockClientRef.current.unsubscribe();
      txQueueRef.current = [];
      isProcessingRef.current = false;
    };
  }, []);

  return (
    <div className="app-container">
      <style jsx>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: #0a0e27;
          color: #e0e0e0;
        }

        .app-container {
          min-height: 100vh;
          padding: 20px;
        }

        .app-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
          padding: 20px;
          background: linear-gradient(135deg, #1a1f3a 0%, #2d3561 100%);
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }

        .app-title {
          font-size: 28px;
          font-weight: 700;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .not-connected {
          text-align: center;
          padding: 60px 20px;
          background: #1a1f3a;
          border-radius: 12px;
          border: 2px dashed #667eea;
        }

        .not-connected h3 {
          font-size: 20px;
          color: #667eea;
        }

        .sections {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }

        @media (max-width: 1024px) {
          .sections {
            grid-template-columns: 1fr;
          }
        }

        .section-card {
          background: #1a1f3a;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          padding-bottom: 15px;
          border-bottom: 1px solid #2d3561;
        }

        .section-header h2 {
          font-size: 20px;
          color: #667eea;
        }

        .header-buttons {
          display: flex;
          gap: 10px;
        }

        .btn {
          padding: 10px 20px;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          font-size: 14px;
        }

        .btn-start {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .btn-start:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .btn-stop {
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: white;
        }

        .btn-stop:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(245, 87, 108, 0.4);
        }

        .btn-reset {
          background: #2d3561;
          color: white;
        }

        .btn-reset:hover {
          background: #3d4571;
        }

        .section-info {
          margin-bottom: 15px;
          display: flex;
          flex-wrap: wrap;
          gap: 15px;
        }

        .section-info p {
          background: #0a0e27;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 500;
        }

        .analysis-rate {
          background: #2d3561;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 500;
          color: #fbbf24;
        }

        .dominance-container {
          background: #0a0e27;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 15px;
        }

        .dominance-bars {
          display: flex;
          gap: 10px;
          margin-bottom: 10px;
        }

        .bar-container {
          flex: 1;
        }

        .bar-label {
          display: flex;
          justify-content: space-between;
          margin-bottom: 5px;
          font-size: 12px;
          font-weight: 600;
        }

        .bar-label.buy {
          color: #10b981;
        }

        .bar-label.sell {
          color: #ef4444;
        }

        .bar-bg {
          height: 24px;
          background: #1a1f3a;
          border-radius: 6px;
          overflow: hidden;
        }

        .bar-fill {
          height: 100%;
          transition: width 0.5s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
        }

        .bar-fill.buy {
          background: linear-gradient(90deg, #10b981 0%, #34d399 100%);
        }

        .bar-fill.sell {
          background: linear-gradient(90deg, #ef4444 0%, #f87171 100%);
        }

        .dominance-result {
          text-align: center;
          padding: 10px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 16px;
        }

        .dominance-result.BUY {
          background: rgba(16, 185, 129, 0.2);
          color: #10b981;
          border: 2px solid #10b981;
        }

        .dominance-result.SELL {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
          border: 2px solid #ef4444;
        }

        .dominance-result.NEUTRAL {
          background: rgba(102, 126, 234, 0.2);
          color: #667eea;
          border: 2px solid #667eea;
        }

        .scroll-box {
          max-height: 400px;
          overflow-y: auto;
          background: #0a0e27;
          border-radius: 8px;
          padding: 10px;
        }

        .scroll-box::-webkit-scrollbar {
          width: 8px;
        }

        .scroll-box::-webkit-scrollbar-track {
          background: #1a1f3a;
          border-radius: 4px;
        }

        .scroll-box::-webkit-scrollbar-thumb {
          background: #667eea;
          border-radius: 4px;
        }

        .empty-msg {
          text-align: center;
          padding: 40px;
          color: #6b7280;
          font-style: italic;
        }

        .tx-item {
          padding: 10px;
          margin-bottom: 8px;
          background: #1a1f3a;
          border-radius: 6px;
          transition: all 0.2s ease;
        }

        .tx-item:hover {
          background: #2d3561;
          transform: translateX(5px);
        }

        .tx-item a {
          color: #667eea;
          text-decoration: none;
          font-family: 'Courier New', monospace;
          font-size: 13px;
          word-break: break-all;
        }

        .tx-item a:hover {
          color: #764ba2;
        }

        .block-table {
          width: 100%;
          border-collapse: collapse;
        }

        .block-table th {
          background: #2d3561;
          padding: 12px;
          text-align: left;
          font-weight: 600;
          color: #667eea;
          position: sticky;
          top: 0;
        }

        .block-table td {
          padding: 12px;
          border-bottom: 1px solid #2d3561;
        }

        .block-table tr:hover {
          background: #1a1f3a;
        }

        .block-table a {
          color: #667eea;
          text-decoration: none;
        }

        .block-table a:hover {
          color: #764ba2;
          text-decoration: underline;
        }
      `}</style>

      {/* HEADER */}
      <header className="app-header">
        <h1 className="app-title">⚡ Ethereum Live Monitor</h1>
        <ConnectButton />
      </header>

      {/* MAIN */}
      <main className="app-main">
        {!isConnected ? (
          <div className="not-connected">
            <h3>Connect your wallet to get started</h3>
          </div>
        ) : (
          <div className="sections">
            {/* Pending Transactions */}
            <section className="section-card">
              <div className="section-header">
                <h2>Pending Transactions</h2>
                <div className="header-buttons">
                  <button
                    className={`btn ${listeningTx ? "btn-stop" : "btn-start"}`}
                    onClick={listeningTx ? stopPendingTx : startPendingTx}
                  >
                    {listeningTx ? "Stop Listening" : "Start Listening"}
                  </button>
                  <button className="btn btn-reset" onClick={resetStats}>
                    Reset
                  </button>
                </div>
              </div>
              
              <div className="section-info">
                <p>Total TX: {txCount}</p>
                <p>Analyzed: {analyzedCount}</p>
                <p className="analysis-rate">Analysis Rate: {analysisRate}%</p>
              </div>

              {/* Buy/Sell Dominance */}
              <div className="dominance-container">
                <div className="dominance-bars">
                  <div className="bar-container">
                    <div className="bar-label buy">
                      <span>BUY</span>
                      <span>{buyCount}</span>
                    </div>
                    <div className="bar-bg">
                      <div 
                        className="bar-fill buy" 
                        style={{ width: `${buyPercentage}%` }}
                      >
                        {buyPercentage > 10 && `${buyPercentage}%`}
                      </div>
                    </div>
                  </div>

                  <div className="bar-container">
                    <div className="bar-label sell">
                      <span>SELL</span>
                      <span>{sellCount}</span>
                    </div>
                    <div className="bar-bg">
                      <div 
                        className="bar-fill sell" 
                        style={{ width: `${sellPercentage}%` }}
                      >
                        {sellPercentage > 10 && `${sellPercentage}%`}
                      </div>
                    </div>
                  </div>
                </div>

                <div className={`dominance-result ${dominance}`}>
                  {totalOrders > 0 ? `${dominance} DOMINANCE` : 'No Data Yet'}
                </div>
              </div>

              <div className="scroll-box">
                {pendingTxs.length === 0 ? (
                  <p className="empty-msg">
                    {listeningTx
                      ? "Listening for pending transactions..."
                      : "Press Start to begin"}
                  </p>
                ) : (
                  pendingTxs.map((tx, i) => (
                    <div className="tx-item" key={i}>
                      <a
                        href={`https://etherscan.io/tx/${tx}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {tx}
                      </a>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* New Blocks */}
            <section className="section-card">
              <div className="section-header">
                <h2>New Blocks</h2>
                <button
                  className={`btn ${
                    listeningBlocks ? "btn-stop" : "btn-start"
                  }`}
                  onClick={listeningBlocks ? stopBlocks : startBlocks}
                >
                  {listeningBlocks ? "Stop Listening" : "Start Listening"}
                </button>
              </div>
              <div className="section-info">
                <p>Count: {blockCount}</p>
              </div>
              <div className="scroll-box">
                {blocks.length === 0 ? (
                  <p className="empty-msg">
                    {listeningBlocks
                      ? "Listening for new blocks..."
                      : "Press Start to begin"}
                  </p>
                ) : (
                  <table className="block-table">
                    <thead>
                      <tr>
                        <th>Block</th>
                        <th>Total Txns</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blocks.map((b, i) => (
                        <tr key={i}>
                          <td>
                            <a
                              href={`https://etherscan.io/block/${b.number}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {b.number.toString()}
                            </a>
                          </td>
                          <td>{b.totalTxs}</td>
                          <td>{b.time}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}