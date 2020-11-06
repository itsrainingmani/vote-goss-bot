const { Octokit } = require('@octokit/rest');
const neatCsv = require('neat-csv');
const config = require('./config.json');
require('dotenv').config();

const octokit = new Octokit({
	auth: process.env.GITHUB_ACCESS_TOKEN,
	userAgent: 'election-notifier v1.0.0',
	previews: ['jean-grey', 'symmetra'],
	timeZone: ['Eastern/US'],
	baseUrl: 'https://api.github.com',
	log: {
		debug: () => {},
		info: () => {},
		warn: console.warn,
		error: console.error,
	},
	request: {
		agent: undefined,
		fetch: undefined,
		timeout: 0,
	},
});

const twClient = require('twilio')(
	process.env.TW_ACC_SID,
	process.env.TW_AUTH_TOKEN
);

let statesToWatch = config.statesToCheck;
let latestCommitHash = config.currentCommitHash;
let recipients = config.peopleToSend;
let lastStateData = '';

let numGlobalErr = 0;

async function checkCommitHasFile(commitHash) {
	try {
		let { data } = await octokit.repos.getCommit({
			owner: 'alex',
			repo: 'nyt-2020-election-scraper',
			ref: latestCommitHash,
		});

		let files_changed = [];
		data.files.forEach((v, i) => {
			files_changed.push(v.filename);
		});

		return files_changed.includes('battleground-state-changes.csv');
	} catch (err) {
		throw new Error(err);
	}
}

async function getFileGithub(
	commitHash,
	filename = 'battleground-state-changes.csv'
) {
	try {
		let { data } = await octokit.repos.getContent({
			owner: 'alex',
			repo: 'nyt-2020-election-scraper',
			path: filename,
			ref: latestCommitHash,
		});

		let b64DecodedContent = Buffer.from(data.content, 'base64').toString();

		return b64DecodedContent;
	} catch (err) {
		throw new Error(err);
	}
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const getMostRecentStateData = async (data) => {
	let parsed = await neatCsv(data);
	let visited = [];
	let latest = {};

	for (let r of parsed) {
		if (!visited.includes(r.state)) {
			visited.push(r.state);
			latest[r.state] = {
				vote_diff: r.vote_differential,
				votes_left: r.votes_remaining,
				timestamp: r.timestamp,
			};
		}
	}

	return latest;
};

(async () => {
	while (true) {
		console.log(`\nExecuting at ${new Date().toString()}`);

		try {
			let { data } = await octokit.repos.listCommits({
				owner: 'alex',
				repo: 'nyt-2020-election-scraper',
			});
			let commitMsgToLookFor = 'Regenerate battleground-state-changes.txt/html';
			let commitHashes = [];

			for (let { sha, commit } of data) {
				if (sha === latestCommitHash) {
					break;
				}

				if (commit.message.includes(commitMsgToLookFor)) {
					commitHashes.push(sha);
				}
			}

			if (commitHashes.length === 0 || commitHashes[0] === latestCommitHash) {
				console.log('No new commits for State Data');
			} else {
				console.log(
					`Setting the new Commit Hash from ${latestCommitHash} to ${commitHashes[0]}`
				);

				latestCommitHash = commitHashes[0];

				let isNewData = await checkCommitHasFile(latestCommitHash);
				if (isNewData) {
					console.log('There is new data!');
					let updatedData = await getFileGithub(latestCommitHash);
					let parsedData = await getMostRecentStateData(updatedData);

					let diffObj = [];

					if (lastStateData === '') {
						console.log(parsedData);
						lastStateData = parsedData;
						for (let k of Object.keys(parsedData)) {
							diffObj.push(
								`${k} now has a margin of ${parsedData[k].vote_diff} with ${parsedData[k].votes_left} votes left`
							);
						}
					} else {
						console.log(parsedData);
						for (let k of Object.keys(parsedData)) {
							let l1 = parsedData[k];
							let l2 = lastStateData[k];

							if (l1.timestamp != l2.timestamp) {
								let o = l1.timestamp > l2.timestamp ? l1 : l2;
								diffObj.push(
									`${k} now has a margin of ${o.vote_diff} with ${o.votes_left} votes left`
								);
							}
						}
					}

					let messageToSend = diffObj.join('\n\n');

					for (let recipient of recipients) {
						let msg = await twClient.messages.create({
							body: `Hey ${recipient.name}. There was an update\n\n${messageToSend}`,
							from: config.twilioPhone,
							to: recipient.num,
						});
					}
				} else {
					console.log('\nNo new data was added');
				}
			}
		} catch (err) {
			console.warn(`Weee Woooo: Error ${err}`);

			numGlobalErr++;

			if (numGlobalErr > 3) {
				console.log('NUMBER OF GLOBAL ERRORS IS MORE THAN 3. GET IT TOGETHER');
				process.exit();
			}
		}

		await delay(60_000);
	}
})();

// (async () => {
// 	let d = await getFileGithub(latestCommitHash);
// 	let b = Buffer.from(d, 'base64').toString();
// 	console.log(b);
// })();
