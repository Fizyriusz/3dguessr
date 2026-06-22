const { spawn } = require('child_process');
const dns = require('dns');

function tryTunnel() {
  console.log("Attempting to request localtunnel subdomain 'guessr-fizii'...");
  const lt = spawn('npx', ['localtunnel', '--port', '1999', '--subdomain', 'guessr-fizii'], { shell: true });

  let output = '';

  lt.stdout.on('data', (data) => {
    const str = data.toString();
    output += str;
    console.log("[localtunnel stdout]:", str.trim());

    if (output.includes('guessr-fizii.loca.lt')) {
      console.log("SUCCESS! Subdomain 'guessr-fizii' acquired successfully!");
    } else if (output.includes('.loca.lt') && !output.includes('guessr-fizii')) {
      console.log("Warning: Acquired a random subdomain instead of 'guessr-fizii'. Retrying in 10 seconds...");
      lt.kill();
    }
  });

  lt.stderr.on('data', (data) => {
    console.error("[localtunnel stderr]:", data.toString().trim());
  });

  lt.on('close', (code) => {
    console.log(`localtunnel process exited with code ${code}. Retrying...`);
    setTimeout(tryTunnel, 10000);
  });
}

tryTunnel();
