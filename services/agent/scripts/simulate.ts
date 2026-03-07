// Call Simulator Script (Step 2)
// Simulates incoming telephony events hitting the Agent service
import axios from 'axios';
import crypto from 'crypto';

const AGENT_URL = 'http://localhost:3001/agent/call-events';

const MOCK_CALLS = [
  {
    caller_id: '+15550000001',
    transcript: 'Hello, I need to reset my main portal password but I forgot my security answers.'
  },
  {
    caller_id: '+15550000002',
    transcript: 'What are your business hours?'
  },
  {
    caller_id: '+15550000003',
    transcript: 'My internet keeps dropping out every 10 minutes since the storm yesterday.'
  }
];

async function runSimulator() {
  console.log(`Starting Call Simulator against Agent Service (${AGENT_URL})...\n`);

  for (const call of MOCK_CALLS) {
    const session_id = crypto.randomUUID();
    console.log(`[Simulator] Dialing in... (session: ${session_id})`);
    console.log(`[Simulator] Caller: ${call.caller_id}`);
    console.log(`[Simulator] Transcript: "${call.transcript}"`);

    try {
      const start = Date.now();
      const response = await axios.post(AGENT_URL, {
        session_id,
        caller_id: call.caller_id,
        transcript: call.transcript
      });
      const ms = Date.now() - start;

      console.log(`[Simulator] Response (${ms}ms):`, response.data);
      console.log('---------------------------------------------------\n');
      
      // Artificial delay between calls
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err: any) {
      console.error(`[Simulator] Error calling Agent Service:`, err.response?.data || err.message);
    }
  }

  console.log('[Simulator] Simulation complete.');
}

runSimulator().catch(console.error);
