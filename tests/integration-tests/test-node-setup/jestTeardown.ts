import { execSync } from 'child_process';
import path from 'path';

export default async function globalTeardown() {
  console.log('Stopping Bee Node...');
  const scriptPath = path.resolve(__dirname, 'stopBeeNode.sh');

  try {
    execSync(`chmod +x ${scriptPath}`); // Ensure the script is executable
    execSync(scriptPath, { stdio: 'inherit' });
    console.log('Bee Node stopped successfully');
  } catch (error) {
    console.error('Error stopping Bee Node:', error);
    process.exit(1);
  }
}
