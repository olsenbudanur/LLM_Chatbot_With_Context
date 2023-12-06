//
// Use this sql query to create the table in the db:
// CREATE TABLE IF NOT EXISTS myvectortable (
//     text TEXT,
//     vector BLOB
// );

//
// ENV VARS (im lazy so i just put them here)
const OPENAI_API_KEY = "API_KEY";
const DB_HOST = "DB_HOST";
const DB_PASS = "DB_PASS";
const DB_USER = "DB_USER";
const DB_NAME = "DB_NAME";

//
// Express stuff
const express = require('express');
const app = express();
const port = 3000; 
app.use(express.json());


//
// Serve the index.html file as the root page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

//
// Reset the database when we want to upload new data
app.get('/resetDatabase', async (req, res) => {
    //
    // Get the database
    const mysql = require('mysql');
    const db = mysql.createConnection({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
    });

    //
    // Return a Promise for the database operation
    return new Promise((resolve, reject) => {
        db.connect((err) => {
            //
            // Check for errors
            if (err) {
                console.error('Error connecting to the database:', err);
                reject(err); // Reject the promise with the error
                return;
            }

            console.log('Connected to the SingleStore database');

            //
            // Query the database for the most similar document
            const query = `DELETE FROM myvectortable;`;
            db.query(query, (err, results) => {
                if (err) {
                    console.error('Error executing the query:', err);
                    db.end(); // Close the connection
                    reject(err); // Reject the promise with the error
                    return;
                }
                
                //
                // Close the connection
                db.end((err) => {
                    if (err) {
                        console.error('Error closing the connection:', err);
                        reject(err); // Reject the promise with the error
                    } else {
                        console.log('Connection to the database closed');
                        resolve(results); // Resolve the promise with the results
                    }
                });
            });
        });
    });
})

//
// Used to upload all pdf files from the "./data" folder to the database in the form of embeddings.
app.get('/uploadDataDir', async (req, res) => {
    //
    // Get all the data from the pdfs
    let allText = await getAllData();

    //
    // Divide the text into chunks of ~ 1000 chars each.
    let chunks = await chunkText(allText);

    //
    // Embed the chunks
    let embeddings = await embedChunks(chunks)

    //
    // Upload the embeddings to the database as a blob in the myvectortable table.
    // The table has 2 columns: text: TEXT, vector: BLOB
    await uploadEmbeddingsToDatabase(embeddings, chunks);

    //
    // Send a response
    res.send('Upload succeeded, I think?');
});

//
// Used to query the most similar documents to a query string.
app.post('/query', async (req, res) => {
    //
    // Get the query string
    let query = req.body.query;

    //
    // Query the database
    let response = await queryEmbeddingsScript(query, 3);

    //
    // Send a response in json format text: response[0].text 
    res.send(response);
});

//
// Used to chat with gpt3.5
app.post('/chat', async (req, res) => {
    //
    // Get the messages
    let messages = req.body.messages;

    //
    // Chat with gpt3.5
    let response = await chatGpt3_5(messages);
    console.log(response)

    //
    // Send a response in json format
    res.send(JSON.stringify(response.choices[0].message.content));
});



//
// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});


//
// Function to ask questions to gpt3.5
async function chatGpt3_5(messages){
    //
    // If there are more than 5 messages, remove the first ones
    if (messages.length > 5) {
        messages = messages.slice(messages.length - 5, messages.length)
    }

    //
    // Get the contents of the last message
    let lastMessage = messages[messages.length - 1].content


    //
    // Get relevant info from the last message
    let lastMessageInfo = await queryEmbeddingsScript(lastMessage)


    //
    // Add the last message info to the content of the last message and back to the messages array
    // in this format "{content of last message} - Use this info to answer the question: {last message info}"
    messages[messages.length - 1].content = `${lastMessage} - Use this info to answer the question: ${lastMessageInfo[0].text}`

    //
    // Set the headers
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_API_KEY,
    }
    
    //
    // Send the request
    let response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            "model": "gpt-3.5-turbo",
            "messages": messages,
            "temperature": 0.7
        })
    });
    
    //
    // Check the response
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    } else {
        let jsonobj = await response.json()
        return jsonobj
        // 
        // Read like this:
        // response.data[0].embedding <- array of 512 floats
    }
}

//
// Function to embed a text using openai api
async function embed(text){
    //
    // Set the headers
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_API_KEY,
    }

    //
    // Send the request
    let response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            'model': "text-embedding-ada-002",
            'input': text
        })
    });

    //
    // Check the response
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    } else {
        let jsonobj = await response.json()
        return jsonobj
        // 
        // Read like this:
        // response.data[0].embedding <- array of 512 floats
    }
}

//
// Query embeddings script
async function queryEmbeddingsScript(query, count = 1) {
    try {
        //
        // Convert the query to an embedding
        let embeddingOfQuery = await embed(query);

        //
        // Get the database
        const mysql = require('mysql');
        const db = mysql.createConnection({
            host: DB_HOST,
            user: DB_USER,
            password: DB_PASS,
            database: DB_NAME,
        });

        //
        // Return a Promise for the database operation
        return new Promise((resolve, reject) => {
            db.connect((err) => {
                //
                // Check for errors
                if (err) {
                    console.error('Error connecting to the database:', err);
                    reject(err); // Reject the promise with the error
                    return;
                }

                console.log('Connected to the SingleStore database');

                //
                // Query the database for the most similar document
                const query = `SELECT text, dot_product(vector, JSON_ARRAY_PACK("${JSON.stringify(embeddingOfQuery.data[0].embedding)}")) AS score FROM myvectortable ORDER BY score DESC LIMIT ${count};`;
                db.query(query, (err, results) => {
                    if (err) {
                        console.error('Error executing the query:', err);
                        db.end(); // Close the connection
                        reject(err); // Reject the promise with the error
                        return;
                    }
                    
                    //
                    // Close the connection
                    db.end((err) => {
                        if (err) {
                            console.error('Error closing the connection:', err);
                            reject(err); // Reject the promise with the error
                        } else {
                            console.log('Connection to the database closed');
                            resolve(results); // Resolve the promise with the results
                        }
                    });
                });
            });
        });
    } catch (error) {
        throw error;
    }
}


//
// Upload the embeddings to the database as a blob in the myvectortable table.
// The table has 2 columns: text: TEXT, vector: BLOB
async function uploadEmbeddingsToDatabase(embeddings, chunks) {
    const mysql = require('mysql');
    const db = mysql.createConnection({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
    });

    db.connect((err) => {
        if (err) {
            console.error('Error connecting to the database:', err);
            return;
        }
        console.log('Connected to the SingleStore database');

        const queries = chunks.map((chunk, i) => {
            return new Promise((resolve, reject) => {
                //
                // Insert the chunk and the embedding into the database
                const query = `INSERT INTO myvectortable (text, vector) VALUES ("${chunk}", JSON_ARRAY_PACK("${JSON.stringify(embeddings[i])}"));`;
                db.query(query, (err, results) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(results);
                    }
                });
            });
        });

        Promise.all(queries)
            .then(() => {
                db.end((err) => {
                    if (err) {
                        console.error('Error closing the connection:', err);
                    } else {
                        console.log('Connection to the database closed');
                    }
                });
            })
            .catch((error) => {
                console.error('Error executing queries:', error);
                db.end(); // Close the connection in case of an error
            });
    });
}

//
// Embeds the chunks and returns the embeddings
async function embedChunks(chunks) {
    let embeddings = [];
    for (const chunk of chunks) {
        let response = await embed(chunk);
        let embedding = response.data[0].embedding;
        embeddings.push(embedding);
        // let json = await response.json();
        // embeddings.push(json.embedding);
    }
    return embeddings
}

//
// Divide the text into chunks of ~ 1000 chars each.
async function chunkText(text, chunkSize = 1000) {
    let sentences = text.split(".");
    let chunks = [];
    let chunk = "";
    for (const sentence of sentences) {
        chunk += sentence + ".";
        if (chunk.length > chunkSize) {
            chunks.push(chunk);
            chunk = "";
        }
    }
    return chunks
}


//
// Run the conversion function for every pdf in "./data" folder
async function getAllData() {
    let fs = require("fs");
    const files = fs.readdirSync("./data");
    let allText = "";
    for (const file of files) {
        if (!file.endsWith(".pdf")) continue;
        allText += await pdfToText(`./data/${file}`);
    }
    return allText
}

//
// Convert pdf to text.
async function pdfToText(path) {
    let answ = ""
    await import("pdfjs-dist").then(async (pdfjsLib) => {
        let allText = "";
        let doc = await pdfjsLib.getDocument(path).promise;
        for (let i = 1; i <= doc.numPages; i++) {
            let page = await doc.getPage(i);
            let content = await page.getTextContent();
            let strings = content.items.map(function(item) {
                return item.str;
            });
            let pageText = strings.join(' ');
            allText += pageText;
        }
        answ = allText
    }).catch(error => {
        //
        // Handle any potential import errors here
        console.error("Error loading pdfjs-dist:", error);
    });
    return answ
}
