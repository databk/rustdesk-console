import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import sharp from 'sharp';

/** Exercise addons through the final executable without opening application data. */
export async function testNativeModules(): Promise<void> {
  const db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const connection = new sqlite3.Database(':memory:', (error) => {
      if (error) reject(error);
      else resolve(connection);
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      db.exec(
        "CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES ('native-ok');",
        (error) => (error ? reject(error) : resolve()),
      );
    });
    const row = await new Promise<{ value: string }>((resolve, reject) => {
      db.get('SELECT value FROM probe', (error, result: { value: string }) =>
        error ? reject(error) : resolve(result),
      );
    });
    assert.equal(row.value, 'native-ok');
  } finally {
    await new Promise<void>((resolve, reject) =>
      db.close((error) => (error ? reject(error) : resolve())),
    );
  }
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#ff0000' },
  })
    .resize(1, 1)
    .png()
    .toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 1);
  assert.equal(metadata.height, 1);
  assert.equal(metadata.format, 'png');
  console.log(JSON.stringify({ sqlite3: 'ok', sharp: 'ok' }));
}
