import { execSync } from 'child_process';
import path from 'path';

export default async function globalSetup() {
  console.log('Starting Bee Node...');
  const scriptPath = path.resolve(__dirname, 'runBeeNode.sh');

  try {
    execSync(`chmod +x ${scriptPath}`); // Ensure the script is executable
    execSync(scriptPath, { stdio: 'inherit' });
    console.log('Bee Node started successfully');
  } catch (error) {
    console.error('Error starting Bee Node:', error);
    process.exit(1);
  }
}
