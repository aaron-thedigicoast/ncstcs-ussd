import dotenv from "dotenv";

dotenv.config({ path: './.env' });

export const sendSms = (name, phone) => {

    const data = {
        sender: "PCRS",
        message: `Welcome to ${name}.\nTo complete your registration and compliance, please click on the link below and upload your documents (Driver's License and Ghana Card):\n\nhttps://ncstcs.vercel.app`,
        recipients: [phone],
    };

    const url = 'https://sms.arkesel.com/api/v2/sms/send';
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': process.env.SMS_API_KEY
        },
        body: JSON.stringify(data)
    };

    fetch(url, options)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log(data);
        })
        .catch(error => {
            console.error('Error:', error);
        });
}

export const sendSmsDetails = ({ name, compliance, phone, email, license, ghanaCard }, msisdn = "") => {

    const data = {
        sender: "PCRS",
        message: `Courier Details\nName: ${name}\nCompliant: ${compliance}\nPhone: ${phone}\nEmail: ${email}\nLicense: ${license}\nGhana Card: ${ghanaCard}`,
        recipients: [msisdn !== "" ? msisdn : phone],
    };

    const url = 'https://sms.arkesel.com/api/v2/sms/send';
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': process.env.SMS_API_KEY
        },
        body: JSON.stringify(data)
    };

    fetch(url, options)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log(data);
        })
        .catch(error => {
            console.error('Error:', error);
        });
}