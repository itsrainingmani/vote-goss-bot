const neatCsv = require('neat-csv');
const { parse } = require('path');
const fs = require('fs').promises;

require('dotenv').config();
const twClient = require('twilio')(
  process.env.TW_ACC_SID,
  process.env.TW_AUTH_TOKEN
);

(async () => {
  // const data = await fs.readFile('battleground-state-changes.csv', 'utf-8');
  // await getMostRecentStateData(data);
  let msg = await twClient.messages.create({
    body: 'This is the ship that made the kessel run',
    from: '+10001110000',
    to: '+11234567890',
  });
  console.log(msg);
})();

// const getMostRecentStateData = async (data) => {
// 	let parsed = await neatCsv(data);
// 	let visited = [];
// 	let latest = {};

// 	for (let r of parsed) {
// 		if (!visited.includes(r.state)) {
// 			visited.push(r.state);
// 			latest[r.state] = {
// 				vote_diff: r.vote_differential,
// 				votes_left: r.votes_remaining,
// 				timestamp: r.timestamp,
// 			};
// 		}
// 	}

// 	return latest;
// };

// fs.createReadStream('battleground-state-changes.csv')
// 	.pipe(csv())
// 	.on('data', (data) => results.push(data))
// 	.on('end', () => {
// 		console.log(results);
// 	});

// (async () => {
// 	const data = await fs.readFile('battleground-state-changes.csv', 'utf-8');
// 	console.log(data);
// 	const c = await csvtojsonV2({ noheader: false }).fromString(data);
// 	console.log(c);
// })();
