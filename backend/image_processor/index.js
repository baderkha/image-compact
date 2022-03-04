const TMP_IMAGE_LOCATION = '/tmp/images';
const imageMin = require('imagemin').default;
const fs = require('fs');
const { S3, DynamoDB, SNS } = require('aws-sdk');
const { Arnifier } = require('../util')

const s3 = new S3();
const sns = new SNS();
const db = new DynamoDB();

const FAILURE_TOPIC = 'image-compact_FAILURE';
const SUCCESS_TOPIC = 'image-compact_SUCCESS';
const arnifySns = new Arnifier().service('sns');


const ImageCompressorHandler = async (event, context, callback) => {
    for (let record of event.Records) {
        
        //
        const imageInfo = JSON.parse(record.Sns.Message);
        const { image_id, s3_keypath, image_type, bucket_original, quality_scale } = imageInfo;
        
        // init directories
        const imageDirectorTmp = `${TMP_IMAGE_LOCATION}/${image_id}`;
        const imageLocationTmp = `${imageDirectorTmp}/image.${image_type}`;
        const compressedLocationTmp = `${imageDirectorTmp}/compressed`;
    

        // prep directories
        fs.mkdirSync(imageDirectorTmp, { recurisve: true });
        fs.mkdirSync(compressedLocationTmp, { recursive: true });

        const file = fs.createWriteStream(imageLocationTmp);
        
        try {
            // 1 - write file to tmp dir
            await downloadFromS3({ Key: s3_keypath, Bucket: bucket_original }, file);

            // 2 - compress file
            let plugin = resolvePlugin(image_type, quality_scale);

            if (!plugin) {
                // handle with failure
            }
            await imageMin([imageLocationTmp], {
                destination: compressedLocationTmp,
                plugins: [plugin]
            })


            // 3 - upload to s3
            const compressedFile = fs.readFileSync(`${compressedLocationTmp}/image.${image_type}`);
            let pathAr = s3_keypath.split('/');
            pathAr.pop();
            pathAr = [...pathAr, `compressed.${image_type}`];
            let pathUpload = pathAr.join('/');
            await s3.putObject({
                Bucket: bucket_original,
                Key: pathUpload,
                Body: compressedFile
            }).promise()
            // 4 
            await handleSuccess({
                image_id,
                compressed_s3_keypath: pathUpload
            })
        } catch (err) {
            await handleFailure(err.toString())
        }

    }
}

/**
 * Dynamically resolve compression as required
 * @param {*} imageType 
 * @param {*} qualityScale 
 * @returns 
 */
const resolvePlugin = (imageType, qualityScale) => {
    switch (imageType) {
        case "jpg": {
            return require('imagemin-mozjpeg')({
                quality: qualityScale
            });
        }
        case "jpeg": {
            return resolvePlugin("jpg", { qualityScale });
        }
        case "png": {
            return require('imagemin-pngquant').default({
                quality: (qualityScale / 100).toFixed(2)
            })
        }
        case "gif": {
            // bad math here just ignore
            qualityScale = qualityScale / 100;
            qualityScale = qualityScale * 170;
            qualityScale = qualityScale + 30;
            // f(x) = max(x) + lower bound - actual
            qualityScale = 200 + 30 - qualityScale;
            return require('imagemin-giflossy')({
                lossy: qualityScale
            })
        }
        case "webbp": {
            return require('imagemin-webp').default({
                quality: qualityScale
            })
        }
    }
    throw new Error('Unsupported Type')
}

const downloadFromS3 = ({ Key, Bucket }, file) => {
    return new Promise((resolve, reject) => {
        const pipe = s3.getObject({
            Bucket: Bucket,
            Key: Key,
        }).createReadStream().pipe(file)
        pipe.on('error', reject);
        pipe.on('close', resolve);

    });
}

const handleFailure = (errorMessage) => {
    return sns.publish({
        Message: errorMessage,
        Subject: 'FAILURE IN JOB',
        TopicArn: arnifySns(FAILURE_TOPIC)
    }).promise().then(() => { }).catch((err) => console.log(err))
}

const handleSuccess = (updatedModel) => {
    return sns.publish({
        TopicArn: arnifySns(SUCCESS_TOPIC),
        Message: JSON.stringify(updatedModel),
        Subject: 'Completed Job'
    }).promise().then(() => { }).catch((err) => console.log(err))
}


module.exports = ImageCompressorHandler;