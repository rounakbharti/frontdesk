import { NotificationsStream } from "./NotificationsStream";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center py-12 px-6">
      <div className="w-full max-w-5xl mb-12">
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-200 dark:border-zinc-800">
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Frontdesk AI
          </h1>
          <div className="flex items-center space-x-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Live SSE Feed</span>
          </div>
        </div>
        
        <p className="text-gray-600 dark:text-gray-300 max-w-2xl text-lg">
          Human-in-the-loop supervisor dashboard. 
          When the AI agent encounters uncertainty below the 85% confidence threshold, calls are routed here for manual resolution.
        </p>
      </div>

      <NotificationsStream />
    </main>
  );
}
