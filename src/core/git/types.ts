export interface Version {
  oid: string;
  parents: string[];
  message: string;
  timestamp: number;
  author: { name: string; email: string };
  committer: { name: string; email: string };
}
