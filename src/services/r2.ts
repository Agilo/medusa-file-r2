import fs from 'fs';
import stream from 'stream';
import path from 'path';
import S3 from 'aws-sdk/clients/s3.js';
import { AbstractFileService } from '@medusajs/medusa';
import type {
  DeleteFileType,
  FileServiceGetUploadStreamResult,
  FileServiceUploadResult,
  GetUploadedFileType,
  UploadStreamDescriptorType,
} from '@medusajs/types';

class R2StorageService extends AbstractFileService {
  bucket: string;
  endpoint: string;
  access_key: string;
  secret_key: string;
  public_url: string;
  cache_control: string;
  presigned_url_expires: number;

  constructor(
    container: Record<string, unknown>,
    options: Record<string, unknown>,
  ) {
    super(container, options);

    if (typeof options.bucket !== 'string' || !options.bucket) {
      throw new Error('R2StorageService requires a bucket');
    }

    if (typeof options.endpoint !== 'string' || !options.endpoint) {
      throw new Error('R2StorageService requires an endpoint');
    }

    if (typeof options.access_key !== 'string' || !options.access_key) {
      throw new Error('R2StorageService requires an access_key');
    }

    if (typeof options.secret_key !== 'string' || !options.secret_key) {
      throw new Error('R2StorageService requires a secret_key');
    }

    if (typeof options.public_url !== 'string' || !options.public_url) {
      throw new Error('R2StorageService requires a public_url');
    }

    this.bucket = options.bucket;
    this.endpoint = options.endpoint;
    this.access_key = options.access_key;
    this.secret_key = options.secret_key;
    this.public_url = options.public_url;
    this.cache_control =
      typeof options.cache_control === 'string'
        ? options.cache_control
        : 'max-age=31536000';
    this.presigned_url_expires =
      typeof options.presigned_url_expires === 'number'
        ? options.presigned_url_expires
        : 60 * 60;
  }

  storageClient() {
    const client = new S3({
      region: 'auto',
      signatureVersion: 'v4',
      endpoint: this.endpoint,
      accessKeyId: this.access_key,
      secretAccessKey: this.secret_key,
    });

    return client;
  }

  private async uploadFile(
    fileData: Express.Multer.File,
    isPrivate?: boolean,
  ): Promise<FileServiceUploadResult> {
    const client = this.storageClient();

    const parsedFilename = path.parse(fileData.originalname);

    const fileKey = `${parsedFilename.name}-${Date.now()}${parsedFilename.ext}`;

    const params: S3.PutObjectRequest = {
      ACL: isPrivate ? 'private' : 'public-read',
      Bucket: this.bucket,
      Key: fileKey,
      Body: fs.createReadStream(fileData.path),
      ContentType: fileData.mimetype,
      CacheControl: this.cache_control,
    };

    try {
      const data = await client.upload(params).promise();

      return {
        url: `${this.public_url}/${data.Key}`,
        key: data.Key,
      };
    } catch (err) {
      console.error(err);
      throw new Error('An error occurred while uploading the file.');
    }
  }

  async upload(
    fileData: Express.Multer.File,
  ): Promise<FileServiceUploadResult> {
    return this.uploadFile(fileData);
  }

  async uploadProtected(
    fileData: Express.Multer.File,
  ): Promise<FileServiceUploadResult> {
    return this.uploadFile(fileData, true);
  }

  async delete(fileData: DeleteFileType): Promise<void> {
    const client = this.storageClient();

    const params = {
      Bucket: this.bucket,
      Key: fileData.fileKey,
    };

    try {
      await client.deleteObject(params).promise();
    } catch (err) {
      console.error(err);
      throw new Error('An error occurred while deleting the file.');
    }
  }

  async getDownloadStream(
    fileData: GetUploadedFileType,
  ): Promise<NodeJS.ReadableStream> {
    const client = this.storageClient();

    const params = {
      Bucket: this.bucket,
      Key: fileData.fileKey,
    };

    try {
      return client.getObject(params).createReadStream();
    } catch (err) {
      console.error(err);
      throw new Error('An error occurred while downloading the file.');
    }
  }

  async getPresignedDownloadUrl(
    fileData: GetUploadedFileType,
  ): Promise<string> {
    const client = this.storageClient();

    const params = {
      Bucket: this.bucket,
      Key: fileData.fileKey,
      Expires: this.presigned_url_expires,
    };

    try {
      return client.getSignedUrlPromise('getObject', params);
    } catch (err) {
      console.error(err);
      throw new Error('An error occurred while downloading the file.');
    }
  }

  async getUploadStreamDescriptor(
    fileData: UploadStreamDescriptorType,
  ): Promise<FileServiceGetUploadStreamResult> {
    const client = this.storageClient();
    const pass = new stream.PassThrough();
    const fileKey = `${fileData.name}.${fileData.ext}`;
    const isPrivate = fileData.isPrivate ?? true;

    const params: S3.PutObjectRequest = {
      ACL: isPrivate ? 'private' : 'public-read',
      Bucket: this.bucket,
      Body: pass,
      Key: fileKey,
      ContentType:
        typeof fileData.contentType === 'string'
          ? fileData.contentType
          : 'application/octet-stream',
    };

    return {
      fileKey,
      writeStream: pass,
      promise: client.upload(params).promise(),
      url: `${this.endpoint}/${this.bucket}/${fileKey}`,
    };
  }
}

export default R2StorageService;
