"use client";

import { useEffect, useState } from "react";
import { HelpRequestCreatedEvent } from "@frontdesk/types";

export function NotificationsStream() {
  const [events, setEvents] = useState<HelpRequestCreatedEvent["payload"][]>([]);

  useEffect(() => {
    // Connect to the Fastify Notification Service SSE endpoint
    const eventSource = new EventSource("http://localhost:3003/notifications/stream");

    eventSource.onmessage = (event) => {
      if (event.data === "connected") {
        console.log("SSE Connected");
        return;
      }

      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "help_request.created") {
          setEvents((prev) => [payload.data.payload, ...prev]);
        } else if (payload.type === "help_request.resolved") {
          setEvents((prev) => 
            prev.filter((req) => req.help_request_id !== payload.data.payload.help_request_id)
          );
        }
      } catch (err) {
        console.error("Failed to parse SSE message", err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  if (events.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-gray-400 dark:border-gray-600 bg-gray-50 dark:bg-zinc-800/50">
        <p className="text-gray-500 font-mono text-sm">No active help requests in the queue.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 mt-8 w-full max-w-4xl mx-auto">
      {events.map((req) => (
        <div 
          key={req.help_request_id}
          className="p-6 rounded-xl border bg-white shadow-sm dark:bg-zinc-900 dark:border-zinc-800 transition-all hover:shadow-md"
        >
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                Customer: <span className="font-mono text-sm">{req.customer_id.slice(0, 8)}...</span>
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Session: {req.call_session_id}
              </p>
            </div>
            <div className="flex flex-col items-end">
              <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/30 dark:text-red-400">
                Requires Assistance
              </span>
              <p className="text-xs text-gray-400 mt-2 font-mono">
                TTL: {new Date(req.ttl_expires_at).toLocaleTimeString()}
              </p>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-zinc-800/50 rounded-lg p-4 mb-4 border border-gray-100 dark:border-zinc-800">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              <span className="text-gray-400 mr-2">Q:</span>
              {req.question_text}
            </p>
            <div className="mt-3 flex items-center text-xs">
              <span className="text-gray-500 mr-2">NLU Confidence:</span>
              <div className="flex-1 max-w-[100px] h-2 bg-gray-200 rounded-full overflow-hidden dark:bg-zinc-700">
                <div 
                  className="h-full bg-blue-500" 
                  style={{ width: `${Math.round(req.agent_confidence * 100)}%` }}
                />
              </div>
              <span className="ml-2 font-mono text-gray-400">
                {(req.agent_confidence * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          <ResolvingActionForm helpRequestId={req.help_request_id} />
        </div>
      ))}
    </div>
  );
}

function ResolvingActionForm({ helpRequestId }: { helpRequestId: string }) {
  const [resolution, setResolution] = useState("");
  const [loading, setLoading] = useState(false);

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const SUPERVISOR_ID = "00000000-0000-0000-0000-000000000001"; // Hardcoded for demo

      const response = await fetch(`http://localhost:3001/help-requests/${helpRequestId}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resolution_text: resolution,
          supervisor_id: SUPERVISOR_ID,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to resolve request");
      }
      
      // We don't need to manually remove it from the UI.
      // The Help Request service will emit 'help_request.resolved' Kafka event,
      // which the Notification SSE loop will catch and automatically remove it for us!
    } catch (err) {
      console.error(err);
      alert("Error resolving request.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleResolve} className="flex gap-3">
      <input
        type="text"
        required
        value={resolution}
        onChange={(e) => setResolution(e.target.value)}
        placeholder="Type resolution answer for the agent..."
        className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-100"
      />
      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-zinc-900"
      >
        {loading ? "Resolving..." : "Resolve"}
      </button>
    </form>
  );
}
