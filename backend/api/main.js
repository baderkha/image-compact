const { S3, DynamoDB, SNS } = require('aws-sdk');

const s3 = new S3();
const sns = new SNS();
const db = new DynamoDB();
const express = require('express');
const app = express();
const SUPPORTED_IMAGE_TYPE = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
const uuid = require('uuid-v4')
const IMAGE_PROCESS_STATUS = {
    DONE: 'DONE',
    IN_PROGRESS: 'IN_PROGRESS',
    FAILED: 'FAILED',
    NOT_STARTED: 'NOT_STARTEDF'
}
const {Arnifier} = require('../util');
const arnifySns = new Arnifier().service('sns');


const S3_BUCKET = 'image_compact_uploads';
const DYNAMO_TABLE = 'image_compact_jobs';
const SNS_TOPIC = 'image-compact_JOB-PROCESS';


app.post('/original-images', async (req, res) => {
    const { image_type } = req.body;
    if (!SUPPORTED_IMAGE_TYPE.includes(image_type)) {
        return res.send(400, `must only  be types ${SUPPORTED_IMAGE_TYPE.join(' , ')}`)
    }
    const imageId = uuid(); // image id
    const s3_keypath = `${imageId}/original.${image_type}`;
    const s3Params = {
        Bucket: S3_BUCKET,
        Key: s3_keypath,
        Expires: 60
    };


    const link = await (
        new Promise(function (resolve, reject) {
            s3.getSignedUrl('getObject', s3Params, function (err, url) {
                if (url) {
                    resolve(url);
                } else {
                    reject(err);
                }
            });
        })).catch((err) => {
            return false
        })


    if (!link) {
        return res.send(500, `cannot process image link , try again later`)
    }


    await (db.putItem({
        TableName: DYNAMO_TABLE,
        Item: {
            image_id: imageId,
            image_type: image_type,
            created_on: new Date(),
            uploaded_on: new Date(),
            status: IMAGE_PROCESS_STATUS.NOT_STARTED,
            s3_keypath,
            bucket_original:S3_BUCKET,
            compressed_s3_keypath: '',

        }
    })
        .promise())
        
    return res.send(201, {
        data: {
            image_id: imageId,
            presigned_url: link
        },
        message: "created presigned"
    })
})


app.post('/compressed-images', async (req, res) => {
    const { image_id, compression_options } = req.body;
    const item = await db.getItem({
        Key: image_id,
        TableName: DYNAMO_TABLE,

    })
        .promise()
        .then((data) => data.Item)
        .catch((err) => false)


    if (!item) {
        return res.send(404, `image_id not found`);
    }
    const doesS3ObjExist = await s3.headObject({
        Bucket: S3_BUCKET,
        Key: item.s3_keypath
    })
        .promise()
        .then((data) => true)
        .catch((err) => false);

    if (!doesS3ObjExist) {
        return res.send(404, `image has not been uploaded !`);
    }
    const updatedItem = {
        ...item,
        status: IMAGE_PROCESS_STATUS.IN_PROGRESS,
    }
    await (db.putItem({
        Item: updatedItem
    })
        .promise())


    await sns.publish({
        TopicArn: await arnifySns(SNS_TOPIC),
        Message: JSON.stringify({ image_info: updatedItem, compression_options })
    }).promise()

    return res.send(202, {
        message: 'begun compression job',
        data: updatedItem
    });

})

app.get('/compressed-images/:id/status', async (req, res) => {
    return await db.getItem({
        TableName: DYNAMO_TABLE,
        Key: req.param('id'),
    })
        .promise()
        .then((data) => res.send(200, data.Item))
        .catch((err) => res.send(404, `Item not found , please make sure it's part of the job`))
})


app.post('/compressed-images/:id/presigned-url', async (req, res) => {
    const item = await db.getItem({
        TableName: DYNAMO_TABLE,
        Key: req.param('id'),
    })
        .promise()
        .then((data) => data.Item)
        .catch(() => false)
    if (!item) {
        return res.send(404, 'image_id not found')
    } else if (item.status != IMAGE_PROCESS_STATUS.DONE) {
        return res.send(400, `cannot request an image that is in progress or that failed ..etc. Must be Done Processing`)
    }

    const image_url = await s3.getSignedUrlPromise('getObject', {
        Bucket: S3_BUCKET,
        Key: item.compressed_s3_keypath
    }).catch((err) => false)

    if (!image_url) {
        return res.send(500, 'could not fetch image due to failure in presistence layer !')
    }

    return res.send(201, {
        message: 'ok presign url created',
        data: image_url
    })
})


module.exports = app