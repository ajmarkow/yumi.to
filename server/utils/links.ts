import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";

function tableName(): string {
  try {
    return Resource.Shortlinks.name;
  } catch {
    const name = process.env.TABLE_NAME;
    if (!name) throw new Error("Missing DynamoDB table name");
    return name;
  }
}

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

export const LINK_PK = "LINK";

export async function getExact(short: string) {
  const res = await doc.send(
    new GetCommand({ TableName: tableName(), Key: { pk: LINK_PK, sk: short } }),
  );
  return (res.Item as Shortlink | undefined) ?? null;
}

export async function getUniquePrefix(short: string) {
  const res = await doc.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
      ExpressionAttributeValues: { ":pk": LINK_PK, ":p": short },
      Limit: 2,
    }),
  );
  const items = (res.Items ?? []) as Shortlink[];
  return items.length === 1 ? items[0] : null;
}

export async function listLinks() {
  const res = await doc.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": LINK_PK },
    }),
  );
  const items = (res.Items ?? []) as Shortlink[];
  items.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return items;
}

export async function createLink(input: { short: string; link: string }) {
  const now = new Date().toISOString();
  const item = {
    pk: LINK_PK,
    sk: input.short,
    id: crypto.randomUUID(),
    short: input.short,
    link: input.link,
    created_at: now,
  };
  await doc.send(
    new PutCommand({
      TableName: tableName(),
      Item: item,
      ConditionExpression: "attribute_not_exists(sk)",
    }),
  );
  return item as Shortlink;
}

export async function updateLink(
  id: string,
  input: { short: string; link: string },
) {
  const current = await getExact(input.short);
  if (current && current.id === id) {
    const item = { ...current, link: input.link };
    await doc.send(
      new PutCommand({
        TableName: tableName(),
        Item: { ...item, pk: LINK_PK, sk: input.short },
      }),
    );
    return item as Shortlink;
  }
  const all = await listLinks();
  const existing = all.find((l) => l.id === id);
  if (!existing) return null;
  const clash = await getExact(input.short);
  if (clash) return null;
  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: tableName(),
            Key: { pk: LINK_PK, sk: existing.short },
            ConditionExpression: "id = :id",
            ExpressionAttributeValues: { ":id": id },
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: {
              pk: LINK_PK,
              sk: input.short,
              id,
              short: input.short,
              link: input.link,
              created_at: existing.created_at ?? new Date().toISOString(),
            },
            ConditionExpression: "attribute_not_exists(sk)",
          },
        },
      ],
    }),
  );
  return { id, short: input.short, link: input.link } as Shortlink;
}

export async function deleteLink(id: string, short: string) {
  await doc.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { pk: LINK_PK, sk: short },
      ConditionExpression: "id = :id",
      ExpressionAttributeValues: { ":id": id },
    }),
  );
}
