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

// let statesToWatch = config.statesToCheck;
let latestCommitHash = config.currentCommitHash;
let recipients = config.peopleToSend;
let lastStateData = '';

let numGlobalErr = 0;

// Checks github to see if the file we need is present in a given commit or not
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

// Gets a file from github and returns the base64 decoded file content
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

// Parse the full csv file and return an object containing only the most recent updates
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
				in_lead: r.leading_candidate_name,
			};
		}
	}

	return latest;
};

(async () => {
	while (true) {
		console.log(`\nExecuting at ${new Date().toString()}`);

		try {
			// Get a list of commits from the repo
			let { data } = await octokit.repos.listCommits({
				owner: 'alex',
				repo: 'nyt-2020-election-scraper',
			});
			let commitMsgToLookFor = 'Regenerate battleground-state-changes.txt/html';
			let commitHashes = [];

			for (let { sha, commit } of data) {
				// Do not go beyond the current commit
				if (sha === latestCommitHash) {
					break;
				}

				// Make sure that the commit message meets our requirement
				if (commit.message.includes(commitMsgToLookFor)) {
					commitHashes.push(sha);
				}
			}

			// If there is no commit that has any new data, move on
			if (commitHashes.length === 0 || commitHashes[0] === latestCommitHash) {
				console.log('No new commits for State Data');
			} else {
				console.log(
					`Setting the new Commit Hash from ${latestCommitHash} to ${commitHashes[0]}`
				);

				// Update our commit hash with the most recent commit that matches from the repo
				latestCommitHash = commitHashes[0];

				let isNewData = await checkCommitHasFile(latestCommitHash);
				if (isNewData) {
					// If this commit has data (The commit message can match but the requieite data file may not exist), get it from Github and parse it as CSV
					console.log('There is new data!');
					let updatedData = await getFileGithub(latestCommitHash);
					let parsedData = await getMostRecentStateData(updatedData);

					let diffObj = [];

					// First time running the program
					console.log(parsedData);

					if (lastStateData === '') {
						lastStateData = parsedData;
						for (let k of Object.keys(parsedData)) {
							let currVoteDiff = parsedData[k];
							let magnitude = currVoteDiff.in_lead === 'Biden' ? '+' : '-';
							diffObj.push(
								`${k} now has a margin of ${magnitude}${currVoteDiff.vote_diff} with ${currVoteDiff.votes_left} votes left`
							);
						}
					} else {
						for (let k of Object.keys(parsedData)) {
							let voteDirection = '';
							let currVoteData = parsedData[k];
							let oldVoteData = lastStateData[k];

							let magnitude = currVoteData.in_lead === 'Biden' ? '+' : '-';

							let currVoteDiff = parseInt(currVoteData.vote_diff);
							let oldVoteDiff = parseInt(oldVoteData.vote_diff);

							if (currVoteDiff < oldVoteDiff) {
								voteDirection = '⬇️';
							} else if (currVoteDiff > oldVoteDiff) {
								voteDirection = '⬆️';
							} else if (currVoteDiff == oldVoteDiff) {
								voteDirection = '';
							}

							diffObj.push(
								`${k}${voteDirection} now has a margin of ${magnitude}${currVoteData.vote_diff} with ${currVoteData.votes_left} votes left`
							);
						}
					}

					let messageToSend = diffObj.join('\n\n');

					for (let recipient of recipients) {
						try {
							let msg = await twClient.messages.create({
								body: `Hey ${recipient.name}. There was an update\n\n${messageToSend}`,
								from: config.twilioPhone,
								to: recipient.num,
							});
							console.log(`Message sent to ${recipient.name}`);
						} catch (err) {
							console.log(`SMS Error: ${err}`);
							continue;
						}
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
