import { useEffect, useRef, useState } from 'react'
import './App.css'

interface FirehoseEvent {
  id: string
  source: string
  type: string
  receivedAt: string
  payload: any
}

const WS_URL = `${import.meta.env.DEV ? 'ws://localhost:8787' : `wss://${location.host}`}/websocket`
const API_URL = `${import.meta.env.DEV ? 'http://localhost:8787' : location.origin}/api/events`

function App() {
  const [events, setEvents] = useState<FirehoseEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [total, setTotal] = useState(0)
  const [perMin, setPerMin] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const eventsRef = useRef<{ time: number }[]>([])

  useEffect(() => {
    fetch(API_URL)
      .then((r) => r.json())
      .then((data) => setEvents(data.slice(0, 50)))
      .catch(console.error)

    const connect = () => {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        setTimeout(connect, 3000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'event') {
          const evt = msg.data
          setEvents((prev) => [evt, ...prev].slice(0, 100))
          setTotal((t) => t + 1)
          eventsRef.current.push({ time: Date.now() })
          eventsRef.current = eventsRef.current.filter((x) => Date.now() - x.time < 60000)
          setPerMin(eventsRef.current.length)
        }
      }
    }

    connect()
    return () => wsRef.current?.close()
  }, [])

  const formatEvent = (evt: FirehoseEvent) => {
    let title = 'Unknown event'
    let repo = 'unknown'
    let author = ''
    let type = evt.type || 'unknown'

    if (evt.source === 'github') {
      if (type === 'push') {
        const commit = evt.payload.head_commit
        title = commit ? commit.message.split('\n')[0] : `Push to ${evt.payload.ref || 'unknown'}`
        repo = evt.payload.repository?.full_name || 'unknown'
        author = evt.payload.pusher?.name || ''
      } else if (type === 'pull_request') {
        title = evt.payload.pull_request?.title || 'PR event'
        repo = evt.payload.repository?.full_name || 'unknown'
        author = evt.payload.pull_request?.user?.login || ''
      } else if (type === 'issues') {
        title = evt.payload.issue?.title || 'Issue event'
        repo = evt.payload.repository?.full_name || 'unknown'
        author = evt.payload.issue?.user?.login || ''
      } else {
        title = `${type}: ${evt.payload.repository?.full_name || 'unknown'}`
        repo = evt.payload.repository?.full_name || 'unknown'
      }
    }

    const typeClass = ['push', 'pull_request', 'issues'].includes(type) ? type : 'default'
    return { title, repo, author, type, typeClass }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>GitHub Firehose</h1>
        <div className={`status ${connected ? 'online' : 'offline'}`}>
          <div className="status-dot" />
          <span>{connected ? 'LIVE' : 'OFFLINE'}</span>
        </div>
      </header>

      <main className="container">
        <div className="config">
          <h2>Webhook URL</h2>
          <code>{location.origin}/github-webhook</code>
          <button className="copy-btn" onClick={() => navigator.clipboard.writeText(location.origin + '/github-webhook')}>
            Copy
          </button>
        </div>

        <div className="stats">
          <div className="stat-card">
            <div className="stat-label">Total Events</div>
            <div className="stat-value">{total}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Events/min</div>
            <div className="stat-value">{perMin}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Connected</div>
            <div className="stat-value">{connected ? 'Yes' : 'No'}</div>
          </div>
        </div>

        <div className="events">
          {events.length === 0 && (
            <div className="empty">
              <div className="empty-icon">📡</div>
              <div>Waiting for events... Set up your GitHub webhook to see commits flow in.</div>
            </div>
          )}
          {events.map((evt) => {
            const { title, repo, author, type, typeClass } = formatEvent(evt)
            return (
              <div key={evt.id} className="event">
                <div className="event-header">
                  <span className={`event-type ${typeClass}`}>{type}</span>
                  <span className="event-time">{new Date(evt.receivedAt).toLocaleTimeString()}</span>
                </div>
                <div className="event-title">{title}</div>
                <div className="event-repo">{repo}</div>
                {author && <div className="event-author">by {author}</div>}
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}

export default App
