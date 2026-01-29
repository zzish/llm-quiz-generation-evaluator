export interface UserModel {
	id: string;
	label: string;
}

const DB_NAME = "llm-evaluator-user-models";
const STORE_NAME = "models";
const KEY_PATH = "id";

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: KEY_PATH });
			}
		};
	});
}

export async function listUserModels(): Promise<UserModel[]> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const req = store.getAll();
		req.onsuccess = () => resolve((req.result as UserModel[]) ?? []);
		req.onerror = () => reject(req.error);
		tx.oncomplete = () => db.close();
	});
}

export async function addUserModel(model: UserModel): Promise<void> {
	const id = model.id?.trim();
	const label = (model.label?.trim() ?? id) || id;
	if (!id) throw new Error("Model ID is required");
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		store.put({ id, label });
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => reject(tx.error);
	});
}

export async function deleteUserModel(id: string): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		store.delete(id);
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => reject(tx.error);
	});
}
