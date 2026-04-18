const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const QUEUE_DIR = path.join(__dirname, '..', 'queue');
const QUEUE_FILE = path.join(QUEUE_DIR, 'pending.json');

if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });

function readQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeQueue(jobs) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(jobs, null, 2));
}

function addJob(data) {
  const jobs = readQueue();
  const job = {
    id: uuidv4(),
    data,
    status: 'pending',
    retries: 0,
    created_at: new Date().toISOString(),
    last_attempt: null,
    error: null,
  };
  jobs.push(job);
  writeQueue(jobs);
  return job;
}

function updateJob(id, updates) {
  const jobs = readQueue();
  const idx = jobs.findIndex(j => j.id === id);
  if (idx === -1) return;
  jobs[idx] = { ...jobs[idx], ...updates };
  writeQueue(jobs);
}

function removeJob(id) {
  const jobs = readQueue().filter(j => j.id !== id);
  writeQueue(jobs);
}

function getPendingJobs() {
  return readQueue().filter(j => j.status === 'pending' || j.status === 'failed');
}

function getAllJobs() {
  return readQueue();
}

module.exports = { addJob, updateJob, removeJob, getPendingJobs, getAllJobs };
